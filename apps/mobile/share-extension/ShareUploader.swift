import Foundation
import Security
import CryptoKit

enum FoundkeepUploadError: LocalizedError {
  case signedOut
  case storage
  case server
  case folderNotFound
  case invalidOrganization
  var errorDescription: String? {
    switch self { case .signedOut: return "Open FoundKeep once to connect this iPhone."; case .storage: return "FoundKeep could not keep a safe local copy."; case .server: return "Saved for upload when FoundKeep is online."; case .folderNotFound: return "That folder no longer exists. Your items are kept safely. Choose another folder or No folder, then save again."; case .invalidOrganization: return "Use up to 20 tags of 40 characters each, and folder names of up to 80 characters, without control characters." }
  }
}

struct FoundkeepSaveResult { let uploaded: Int; let queued: Int }

struct FoundkeepFolder: Codable {
  let id: String
  let name: String
  let count: Int
}

struct FoundkeepTag: Codable {
  let name: String
  let count: Int
}

struct FoundkeepOrganization: Codable {
  var folders: [FoundkeepFolder]
  let tags: [FoundkeepTag]
  let suggestedTags: [String]
  let suggestedFolders: [String]

  static let starters = FoundkeepOrganization(folders: [], tags: [], suggestedTags: ["Read later", "Inspiration", "Work", "Personal"], suggestedFolders: ["Reading", "Projects", "Inspiration"])
}

private struct FoundkeepOrganizationCache: Codable {
  let credentialDigest: String
  let organization: FoundkeepOrganization
}

private struct FoundkeepFolderResponse: Decodable { let folder: FoundkeepFolder }

// Every authenticated endpoint has a canonical URL. Never forward its credentials through redirects.
private final class FoundkeepNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

final class ShareUploader {
  private let manager = FileManager.default
  private let container: URL
  private let queue: URL
  private let policy = FoundkeepSharePolicy.current
  private let connection: FoundkeepQueueSession?
  private var batch = FoundkeepShareBatch()
  private let session = URLSession(configuration: .ephemeral, delegate: FoundkeepNoRedirectDelegate(), delegateQueue: nil)

  init() throws {
    guard let container = manager.containerURL(forSecurityApplicationGroupIdentifier: (Bundle.main.object(forInfoDictionaryKey: "FoundkeepAppGroup") as? String ?? "group.app.foundkeep.ios")) else { throw FoundkeepUploadError.storage }
    self.container = FoundkeepEnvironmentStorage.container(container)
    connection = try? Self.readConnection()
    queue = self.container.appendingPathComponent("queue", isDirectory: true)
    try manager.createDirectory(at: queue, withIntermediateDirectories: true)
  }

  var isConnected: Bool { (try? token()) != nil }

  var cachedOrganization: FoundkeepOrganization? {
    let url = container.appendingPathComponent("organization.json")
    guard let token = try? token(),
          let data = try? Data(contentsOf: url),
          let cache = try? JSONDecoder().decode(FoundkeepOrganizationCache.self, from: data),
          cache.credentialDigest == credentialDigest(token) else {
      try? manager.removeItem(at: url)
      return nil
    }
    return cache.organization
  }

  func loadOrganization() async throws -> FoundkeepOrganization {
    let (data, token) = try await organizationRequest(path: "/api/mobile/organization")
    let organization = try JSONDecoder().decode(FoundkeepOrganization.self, from: data)
    cacheOrganization(organization, token: token)
    return organization
  }

  func createFolder(name: String) async throws -> FoundkeepFolder {
    guard let name = FoundkeepQueueScope.organizationName(name, limit: 80) else { throw FoundkeepUploadError.invalidOrganization }
    let body = try JSONSerialization.data(withJSONObject: ["name": name])
    let (data, token) = try await organizationRequest(path: "/api/mobile/folders", body: body)
    let folder = try JSONDecoder().decode(FoundkeepFolderResponse.self, from: data).folder
    var organization = cachedOrganization ?? .starters
    organization.folders.removeAll { $0.id == folder.id }
    organization.folders.append(folder)
    cacheOrganization(organization, token: token)
    return folder
  }

  private func organizationRequest(path: String, body: Data? = nil) async throws -> (Data, String) {
    guard let token = try token() else { throw FoundkeepUploadError.signedOut }
    var request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")\(path)")!)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.timeoutInterval = 8
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await session.data(for: request)
    guard try self.token() == token else { throw FoundkeepUploadError.signedOut }
    guard let http = response as? HTTPURLResponse else { throw FoundkeepUploadError.server }
    if http.statusCode == 401 { throw FoundkeepUploadError.signedOut }
    guard (200...299).contains(http.statusCode) else { throw FoundkeepUploadError.server }
    return (data, token)
  }

  private func cacheOrganization(_ organization: FoundkeepOrganization, token: String) {
    guard (try? self.token()) == token else { return }
    let cache = FoundkeepOrganizationCache(credentialDigest: credentialDigest(token), organization: organization)
    guard let data = try? JSONEncoder().encode(cache) else { return }
    try? data.write(to: container.appendingPathComponent("organization.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  private func credentialDigest(_ token: String) -> String {
    SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  func save(_ items: [FoundkeepShareItem], note: String, folderId: String? = nil, userTags: [String] = []) async throws -> FoundkeepSaveResult {
    guard let token = try token() else { throw FoundkeepUploadError.signedOut }
    guard userTags.count <= 20 else { throw FoundkeepUploadError.invalidOrganization }
    var normalizedTags: [String] = []
    var seenTags = Set<String>()
    for value in userTags {
      guard let name = FoundkeepQueueScope.organizationName(value, limit: 40) else { throw FoundkeepUploadError.invalidOrganization }
      if seenTags.insert(name.lowercased()).inserted { normalizedTags.append(name) }
    }
    var records: [(FoundkeepShareItem, URL)] = []
    // Persist the whole batch before its first network request. An explicit
    // folder correction keeps the batch and client IDs of the original save.
    for item in batch.pendingItems(items, clientId: { $0.clientId }) {
      guard try self.token() == token else { throw FoundkeepUploadError.signedOut }
      records.append((item, try enqueue(item, batchId: batch.id, note: note, folderId: folderId, userTags: normalizedTags)))
    }
    for (item, recordURL) in records {
      do {
        try await submit(recordURL, token: token)
        batch.markUploaded(clientId: item.clientId)
      } catch FoundkeepUploadError.folderNotFound {
        for (_, pendingURL) in records { markOrganizationReview(pendingURL) }
        throw FoundkeepUploadError.folderNotFound
      } catch { }
    }
    let uploaded = items.count - batch.pendingItems(items, clientId: { $0.clientId }).count
    return FoundkeepSaveResult(uploaded: uploaded, queued: items.count - uploaded)
  }

  private func enqueue(_ item: FoundkeepShareItem, batchId: String, note: String, folderId: String?, userTags: [String]) throws -> URL {
    guard let connection, try Self.readConnection() == connection else { throw FoundkeepUploadError.signedOut }
    let metadata = captureMetadata(item, batchId: batchId, note: note, folderId: folderId, userTags: userTags)
    if item.payloadPath != nil {
      let header = try JSONSerialization.data(withJSONObject: metadata)
      guard header.count <= 16 * 1024 else { throw FoundkeepUploadError.storage }
    }
    var record: [String: Any] = [
      "id": UUID().uuidString, "clientId": item.clientId, "batchId": batchId,
      "ownerAccountId": connection.accountId, "requiresOrganizationReview": false,
      "metadata": metadata,
      "attempts": 0, "nextAttemptAt": 0, "createdAt": Date().timeIntervalSince1970 * 1000,
    ]
    if let payloadPath = item.payloadPath { record["payloadPath"] = payloadPath }
    let data = try JSONSerialization.data(withJSONObject: record)
    let url = queue.appendingPathComponent("\(item.clientId).json")
    if manager.fileExists(atPath: url.path) {
      guard let existingData = try? Data(contentsOf: url),
            let existing = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any],
            FoundkeepQueueScope.owns(existing["ownerAccountId"] as? String, accountId: connection.accountId) else { throw FoundkeepUploadError.storage }
    }
    guard try Self.readConnection() == connection else { throw FoundkeepUploadError.signedOut }
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    return url
  }

  private func submit(_ recordURL: URL, token: String) async throws {
    let data = try Data(contentsOf: recordURL)
    guard let record = try JSONSerialization.jsonObject(with: data) as? [String: Any], let metadata = record["metadata"] as? [String: Any] else { throw FoundkeepUploadError.storage }
    guard FoundkeepQueueScope.owns(record["ownerAccountId"] as? String, accountId: connection?.accountId), try self.token() == token else { throw FoundkeepUploadError.signedOut }
    let metadataData = try JSONSerialization.data(withJSONObject: metadata)
    var request: URLRequest
    if let path = record["payloadPath"] as? String {
      let payloadURL = container.appendingPathComponent(path)
      let size = (try manager.attributesOfItem(atPath: payloadURL.path)[.size] as? NSNumber)?.intValue ?? 0
      request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")/api/mobile/captures/file")!)
      request.httpMethod = "POST"
      request.setValue(base64URL(metadataData), forHTTPHeaderField: "X-FoundKeep-Capture")
      request.setValue(metadata["declaredMime"] as? String ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
      request.setValue(String(size), forHTTPHeaderField: "Content-Length")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.timeoutInterval = policy.uploadTimeout
      guard try self.token() == token else { throw FoundkeepUploadError.signedOut }
      let (data, response) = try await session.upload(for: request, fromFile: payloadURL)
      try validateCaptureResponse(data: data, response: response)
      try? manager.removeItem(at: payloadURL)
    } else {
      request = URLRequest(url: URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepOrigin") as? String ?? "https://foundkeep.app")/api/captures")!)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.httpBody = metadataData
      request.timeoutInterval = policy.uploadTimeout
      guard try self.token() == token else { throw FoundkeepUploadError.signedOut }
      let (data, response) = try await session.data(for: request)
      try validateCaptureResponse(data: data, response: response)
    }
    try manager.removeItem(at: recordURL)
  }

  private func validateCaptureResponse(data: Data, response: URLResponse) throws {
    guard let http = response as? HTTPURLResponse else { throw FoundkeepUploadError.server }
    if FoundkeepQueueScope.isMissingFolder(statusCode: http.statusCode, data: data) { throw FoundkeepUploadError.folderNotFound }
    guard (200...299).contains(http.statusCode) else { throw FoundkeepUploadError.server }
  }

  private func markOrganizationReview(_ recordURL: URL) {
    guard let data = try? Data(contentsOf: recordURL),
          var record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          FoundkeepQueueScope.owns(record["ownerAccountId"] as? String, accountId: connection?.accountId) else { return }
    record["requiresOrganizationReview"] = true
    record["organizationReviewReason"] = "folder_not_found"
    if let updated = try? JSONSerialization.data(withJSONObject: record) { try? updated.write(to: recordURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
  }

  private func captureMetadata(_ item: FoundkeepShareItem, batchId: String, note: String, folderId: String?, userTags: [String]) -> [String: Any] {
    let now = Int(Date().timeIntervalSince1970 * 1000)
    let hasPayload = item.payloadPath != nil
    var metadata: [String: Any] = [
      "clientId": item.clientId, "batchId": batchId, "type": item.type,
      "capturedAt": now, "processingOptions": ["ocr": true, "summaries": true, "tags": true],
      "folderId": folderId as Any? ?? NSNull(), "userTags": userTags,
    ]
    if !hasPayload, let value = item.sourceURL { metadata["sourceUrl"] = value }
    if !hasPayload, let value = item.sourceTitle { metadata["sourceTitle"] = value }
    if let value = item.selectionText { metadata["selectionText"] = value }
    if !hasPayload, let value = item.pageContext?["readableText"] as? String, !value.isEmpty { metadata["articleText"] = String(value.prefix(policy.articleCharacters)) }
    if !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { metadata["noteText"] = String(note.prefix(hasPayload ? 500 : 50_000)) }
    if let value = item.fileName { metadata["fileName"] = value }
    if let value = item.mime { metadata["declaredMime"] = value }
    metadata["provenance"] = provenance(item, capturedAt: now, compact: hasPayload)
    return metadata
  }

  private func provenance(_ item: FoundkeepShareItem, capturedAt: Int, compact: Bool) -> [String: Any] {
    let context = item.pageContext ?? [:]
    let method = item.type == "bookmark" ? "ios-share-url" : item.type == "selection" ? "ios-share-text" : "ios-share-\(item.type)"
    let pageUrl: Any = context["pageUrl"] ?? item.sourceURL ?? NSNull()
    let compactTitle: Any
    if let title = item.sourceTitle {
      compactTitle = String(title.prefix(250))
    } else {
      compactTitle = NSNull()
    }
    let pageTitle: Any = compact ? compactTitle : (context["pageTitle"] ?? item.sourceTitle ?? NSNull())
    let canonicalUrl: Any = compact ? NSNull() : (context["canonicalUrl"] ?? NSNull())
    let siteName: Any = compact ? NSNull() : (context["siteName"] ?? NSNull())
    let description: Any = compact ? NSNull() : (context["description"] ?? NSNull())
    let authors: Any = compact ? [String]() : (context["authors"] ?? [String]())
    let leadImageUrl: Any = compact ? NSNull() : (context["leadImageUrl"] ?? NSNull())
    let faviconUrl: Any = compact ? NSNull() : (context["faviconUrl"] ?? NSNull())
    let headings: Any = compact ? [String]() : (context["headings"] ?? [String]())
    var value: [String: Any] = [
      "schemaVersion": 1, "captureMethod": method,
      "pageUrl": pageUrl,
      "canonicalUrl": canonicalUrl, "pageTitle": pageTitle,
      "siteName": siteName, "description": description,
      "authors": authors, "publishedAt": context["publishedAt"] ?? NSNull(), "modifiedAt": context["modifiedAt"] ?? NSNull(),
      "language": context["language"] ?? NSNull(), "leadImageUrl": leadImageUrl, "faviconUrl": faviconUrl,
      "targetUrl": NSNull(), "headings": headings, "capturedAt": capturedAt, "extractedAt": capturedAt,
      "extractorVersion": 1, "contentHash": item.contentHash ?? NSNull(), "extractionStatus": "complete", "extractionError": NSNull(),
    ]
    if let fileName = item.fileName { value["originalFileName"] = fileName }
    if let mime = item.mime { value["declaredMime"] = mime }
    if item.bytes > 0 { value["byteSize"] = item.bytes }
    return value
  }

  private func token() throws -> String? {
    guard let current = try Self.readConnection(), current == connection else { return nil }
    return current.token
  }

  private static func readConnection() throws -> FoundkeepQueueSession? {
    let account = Data("foundkeep-device-token".utf8)
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: (Bundle.main.object(forInfoDictionaryKey: "FoundkeepKeychainService") as? String ?? "app.foundkeep.shared"),
      kSecAttrAccount as String: "foundkeep-device-token", kSecAttrGeneric as String: account,
      kSecReturnData as String: true, kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if let group = Bundle.main.object(forInfoDictionaryKey: "FoundkeepKeychainAccessGroup") as? String, !group.contains("$(") { query[kSecAttrAccessGroup as String] = group }
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let attributes = result as? [String: Any], let data = attributes[kSecValueData as String] as? Data else { throw FoundkeepUploadError.signedOut }
    return FoundkeepQueueScope.session(token: String(data: data, encoding: .utf8), boundAccountId: attributes[kSecAttrLabel as String] as? String)
  }

  private func base64URL(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
