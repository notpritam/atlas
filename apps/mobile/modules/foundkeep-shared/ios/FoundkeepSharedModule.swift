import ExpoModulesCore
import Foundation
import Security

private enum FoundkeepSharedError: Error {
  case configuration
  case keychain(OSStatus)
}

private final class FoundkeepSharedNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

private final class FoundkeepSharedStore {
  static let group = (Bundle.main.object(forInfoDictionaryKey: "FoundkeepAppGroup") as? String ?? "group.app.foundkeep.ios")
  static let service = (Bundle.main.object(forInfoDictionaryKey: "FoundkeepKeychainService") as? String ?? "app.foundkeep.shared")
  static let tokenAccount = "foundkeep-device-token"
  private let manager = FileManager.default
  private let sessionLock = NSLock()
  private let retryLock = NSLock()
  private var retryInProgress = false
  private let uploadSession = URLSession(configuration: .ephemeral, delegate: FoundkeepSharedNoRedirectDelegate(), delegateQueue: nil)

  private var keychainGroup: String? { Bundle.main.object(forInfoDictionaryKey: "FoundkeepKeychainAccessGroup") as? String }
  private var container: URL? { manager.containerURL(forSecurityApplicationGroupIdentifier: Self.group).map { FoundkeepEnvironmentStorage.container($0) } }
  private var queue: URL? { container?.appendingPathComponent("queue", isDirectory: true) }

  func token() throws -> String? {
    sessionLock.lock()
    defer { sessionLock.unlock() }
    return try credential()?.token
  }

  // Token and account binding are returned by one Keychain read, so a session
  // switch cannot pair a new token with an old UserDefaults account snapshot.
  private func credential() throws -> (token: String, accountId: String?)? {
    var query = keychainQuery()
    query[kSecReturnData as String] = true
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw FoundkeepSharedError.keychain(status) }
    guard let attributes = result as? [String: Any],
          let data = attributes[kSecValueData as String] as? Data,
          let token = String(data: data, encoding: .utf8) else { return nil }
    return (token, attributes[kSecAttrLabel as String] as? String)
  }

  private func currentSession() throws -> FoundkeepQueueSession? {
    sessionLock.lock()
    defer { sessionLock.unlock() }
    guard let value = try credential() else { return nil }
    return FoundkeepQueueScope.session(token: value.token, boundAccountId: value.accountId)
  }

  func set(token: String, accountJSON: String) throws {
    guard let accountId = FoundkeepQueueScope.accountId(from: accountJSON), !token.isEmpty else { throw FoundkeepSharedError.configuration }
    sessionLock.lock()
    defer { sessionLock.unlock() }
    let previous = try credential()
    if previous?.token != token || previous?.accountId != accountId { clearOrganizationCache() }
    UserDefaults(suiteName: Self.group)?.removeObject(forKey: FoundkeepEnvironmentStorage.key("account"))
    var query = keychainQuery()
    let deletion = SecItemDelete(query as CFDictionary)
    guard deletion == errSecSuccess || deletion == errSecItemNotFound else { throw FoundkeepSharedError.keychain(deletion) }
    query[kSecValueData as String] = Data(token.utf8)
    query[kSecAttrLabel as String] = accountId
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw FoundkeepSharedError.keychain(status) }
    UserDefaults(suiteName: Self.group)?.set(accountJSON, forKey: FoundkeepEnvironmentStorage.key("account"))
  }

  // The caller obtained accountJSON from /me using this token. A delayed refresh
  // must never reinstall a session that was signed out or replaced meanwhile.
  func refreshSession(token: String, accountJSON: String) throws {
    guard let accountId = FoundkeepQueueScope.accountId(from: accountJSON) else { throw FoundkeepSharedError.configuration }
    sessionLock.lock()
    defer { sessionLock.unlock() }
    guard let current = try credential(), current.token == token else { return }
    if let existing = current.accountId, existing != accountId { throw FoundkeepSharedError.configuration }
    let status = SecItemUpdate(keychainQuery() as CFDictionary, [kSecAttrLabel as String: accountId] as CFDictionary)
    guard status == errSecSuccess else { throw FoundkeepSharedError.keychain(status) }
    if current.accountId != accountId { clearOrganizationCache() }
    UserDefaults(suiteName: Self.group)?.set(accountJSON, forKey: FoundkeepEnvironmentStorage.key("account"))
  }

  func clear() throws {
    sessionLock.lock()
    defer { sessionLock.unlock() }
    let status = SecItemDelete(keychainQuery() as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { throw FoundkeepSharedError.keychain(status) }
    UserDefaults(suiteName: Self.group)?.removeObject(forKey: FoundkeepEnvironmentStorage.key("account"))
    clearOrganizationCache()
  }

  private func clearOrganizationCache() {
    if let container { try? manager.removeItem(at: container.appendingPathComponent("organization.json")) }
  }

  func policy() -> String? { UserDefaults(suiteName: Self.group)?.string(forKey: FoundkeepEnvironmentStorage.key("mobile-policy")) }
  func set(policy: String) { UserDefaults(suiteName: Self.group)?.set(policy, forKey: FoundkeepEnvironmentStorage.key("mobile-policy")) }

  func records() -> [(FoundkeepPendingRecord, URL)] {
    guard let queue else { return [] }
    try? manager.createDirectory(at: queue, withIntermediateDirectories: true)
    let files = (try? manager.contentsOfDirectory(at: queue, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }.compactMap { url in
      guard let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(FoundkeepPendingRecord.self, from: data) else { return nil }
      return (record, url)
    }.sorted { $0.0.createdAt < $1.0.createdAt }
  }

  func pendingCount(blockedOnly: Bool = false) -> Int {
    guard let current = try? currentSession() else { return 0 }
    return records().filter { record, _ in
      FoundkeepQueueScope.owns(record.ownerAccountId, accountId: current.accountId)
        && (!blockedOnly || FoundkeepQueueScope.needsFolderReview(required: record.requiresOrganizationReview, reason: record.organizationReviewReason))
    }.count
  }

  func resolveBlockedPendingToUnfiled() throws -> Int {
    guard let current = try currentSession() else { return 0 }
    var resolved = 0
    for (var record, recordURL) in records() {
      guard FoundkeepQueueScope.owns(record.ownerAccountId, accountId: current.accountId),
            FoundkeepQueueScope.needsFolderReview(required: record.requiresOrganizationReview, reason: record.organizationReviewReason) else { continue }
      guard try currentSession() == current else { return resolved }
      guard record.resolveFolderToUnfiled(for: current.accountId) else { continue }
      let data = try JSONEncoder().encode(record)
      try data.write(to: recordURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      resolved += 1
    }
    return resolved
  }

  func retry() async throws -> Int {
    guard beginRetry() else { return 0 }
    defer { endRetry() }
    guard let current = try currentSession() else { return 0 }
    var completed = 0
    for (var record, recordURL) in records() where record.nextAttemptAt <= Date().timeIntervalSince1970 * 1000 {
      // Unscoped legacy records and another account's records stay untouched.
      guard FoundkeepQueueScope.mayRetry(ownerAccountId: record.ownerAccountId, requiresOrganizationReview: record.requiresOrganizationReview, accountId: current.accountId) else { continue }
      guard try currentSession() == current else { return completed }
      var metadata = record.metadata
      metadata["clientId"] = .string(record.clientId)
      if let batchId = record.batchId { metadata["batchId"] = .string(batchId) }
      let metadataData = try JSONEncoder().encode(metadata)
      var request: URLRequest
      var payloadURL: URL?
      if let payloadPath = record.payloadPath, let container {
        payloadURL = container.appendingPathComponent(payloadPath)
        request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")/api/mobile/captures/file")!)
        request.httpMethod = "POST"
        request.setValue(metadataData.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: ""), forHTTPHeaderField: "X-Foundkeep-Capture")
        if case .string(let mime) = metadata["declaredMime"] { request.setValue(mime, forHTTPHeaderField: "Content-Type") }
        if let payloadURL, let bytes = try? payloadURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
          request.setValue(String(bytes), forHTTPHeaderField: "Content-Length")
        }
      } else {
        request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")/api/captures")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = metadataData
      }
      request.setValue("Bearer \(current.token)", forHTTPHeaderField: "Authorization")
      request.timeoutInterval = 20
      do {
        guard try currentSession() == current else { return completed }
        let result: (Data, URLResponse)
        if let payloadURL {
          result = try await uploadSession.upload(for: request, fromFile: payloadURL)
        } else {
          result = try await uploadSession.data(for: request)
        }
        guard let http = result.1 as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if FoundkeepQueueScope.isMissingFolder(statusCode: http.statusCode, data: result.0) {
          record.requiresOrganizationReview = true
          record.organizationReviewReason = "folder_not_found"
          if let data = try? JSONEncoder().encode(record) { try? data.write(to: recordURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
          continue
        }
        guard (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        if let payloadPath = record.payloadPath, let container { try? manager.removeItem(at: container.appendingPathComponent(payloadPath)) }
        try? manager.removeItem(at: recordURL)
        completed += 1
      } catch {
        record.attempts += 1
        record.nextAttemptAt = Date().timeIntervalSince1970 * 1000 + min(900_000, 5_000 * pow(2, Double(max(0, min(8, record.attempts - 1)))))
        if let data = try? JSONEncoder().encode(record) { try? data.write(to: recordURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
      }
    }
    return completed
  }

  private func beginRetry() -> Bool {
    retryLock.lock()
    defer { retryLock.unlock() }
    guard !retryInProgress else { return false }
    retryInProgress = true
    return true
  }

  private func endRetry() {
    retryLock.lock()
    defer { retryLock.unlock() }
    retryInProgress = false
  }

  func downloadCaptureFile(id: String, fileName: String) async throws -> String {
    guard id.range(of: "^[A-Za-z0-9-]{1,80}$", options: .regularExpression) != nil else { throw URLError(.badURL) }
    guard let token = try token() else { throw URLError(.userAuthenticationRequired) }
    var request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")/api/mobile/captures/\(id)/file")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.timeoutInterval = 30
    let (temporary, response) = try await uploadSession.download(for: request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(FoundkeepEnvironmentStorage.key("Foundkeep Exports"), isDirectory: true)
    try manager.createDirectory(at: cache, withIntermediateDirectories: true)
    let leaf = (fileName as NSString).lastPathComponent.components(separatedBy: .controlCharacters).joined().trimmingCharacters(in: .whitespacesAndNewlines)
    let safeName = String((leaf.isEmpty ? "Shared file" : leaf).prefix(180))
    let destination = cache.appendingPathComponent("\(id)-\(safeName)")
    try? manager.removeItem(at: destination)
    try manager.moveItem(at: temporary, to: destination)
    return destination.absoluteString
  }

  private func keychainQuery() -> [String: Any] {
    let account = Data(Self.tokenAccount.utf8)
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: Self.tokenAccount,
      kSecAttrGeneric as String: account,
    ]
    if let keychainGroup, !keychainGroup.contains("$(") { query[kSecAttrAccessGroup as String] = keychainGroup }
    return query
  }
}

public class FoundkeepSharedModule: Module {
  private let store = FoundkeepSharedStore()
  public func definition() -> ModuleDefinition {
    Name("FoundkeepShared")
    AsyncFunction("setSession") { (token: String, accountJSON: String) in try self.store.set(token: token, accountJSON: accountJSON) }
    AsyncFunction("refreshSession") { (token: String, accountJSON: String) in try self.store.refreshSession(token: token, accountJSON: accountJSON) }
    AsyncFunction("getToken") { () -> String? in try self.store.token() }
    AsyncFunction("clearSession") { try self.store.clear() }
    AsyncFunction("pendingCount") { self.store.pendingCount() }
    AsyncFunction("blockedPendingCount") { self.store.pendingCount(blockedOnly: true) }
    AsyncFunction("resolveBlockedPendingToUnfiled") { () throws -> Int in try self.store.resolveBlockedPendingToUnfiled() }
    AsyncFunction("retryPending") { () async throws -> Int in try await self.store.retry() }
    AsyncFunction("downloadCaptureFile") { (captureId: String, fileName: String) async throws -> String in
      try await self.store.downloadCaptureFile(id: captureId, fileName: fileName)
    }
    AsyncFunction("getPolicy") { self.store.policy() }
    AsyncFunction("setPolicy") { (policyJSON: String) in self.store.set(policy: policyJSON) }
  }
}
