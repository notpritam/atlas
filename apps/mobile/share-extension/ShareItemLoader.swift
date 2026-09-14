import CryptoKit
import Foundation
import UniformTypeIdentifiers

struct FoundkeepShareItem {
  let clientId: String
  let type: String
  let sourceURL: String?
  let sourceTitle: String?
  let selectionText: String?
  let fileName: String?
  let mime: String?
  let bytes: Int
  let payloadPath: String?
  let contentHash: String?
  let pageContext: [String: Any]?
}

enum FoundkeepItemError: LocalizedError {
  case unavailable
  case tooLarge
  case disabled
  var errorDescription: String? {
    switch self { case .unavailable: return "That item could not be read."; case .tooLarge: return "This file is larger than FoundKeep currently accepts."; case .disabled: return "This kind of capture is temporarily unavailable." }
  }
}

final class ShareItemLoader: @unchecked Sendable {
  private let manager = FileManager.default
  private let policy: FoundkeepSharePolicy
  private let container: URL

  init(container: URL? = nil, policy: FoundkeepSharePolicy = .current) throws {
    self.policy = policy
    guard let value = container ?? manager.containerURL(forSecurityApplicationGroupIdentifier: (Bundle.main.object(forInfoDictionaryKey: "FoundkeepAppGroup") as? String ?? "group.app.foundkeep.ios")) else { throw FoundkeepItemError.unavailable }
    self.container = container == nil ? FoundkeepEnvironmentStorage.container(value) : value
  }

  func load(_ inputs: [NSExtensionItem]) async throws -> [FoundkeepShareItem] {
    var output: [FoundkeepShareItem] = []
    for input in inputs {
      if output.count >= policy.batchItems { break }
      let initialCount = output.count
      var sharedContext: [String: Any]? = nil
      for provider in input.attachments ?? [] {
        if let context = try await webpageContext(provider) { sharedContext = context; break }
      }
      for provider in input.attachments ?? [] {
        if output.count >= policy.batchItems { break }
        if let item = try await load(provider, title: input.attributedTitle?.string, sharedContext: sharedContext) { output.append(item) }
      }
      // Safari can supply only the preprocessing property list, with no URL
      // attachment. Its validated page URL is then the item being shared.
      if output.count == initialCount, let context = sharedContext,
         let pageURL = context["pageUrl"] as? String, let url = URL(string: pageURL) {
        output.append(try bookmark(url, title: input.attributedTitle?.string, context: context))
      }
    }
    if output.isEmpty { throw FoundkeepItemError.unavailable }
    return output
  }

  func discard(_ items: [FoundkeepShareItem]) {
    for item in items {
      // A save can remain queued after a recoverable folder error or a session
      // switch. Closing the sheet must not delete its durable payload.
      let record = container.appendingPathComponent("queue/\(item.clientId).json")
      guard !manager.fileExists(atPath: record.path) else { continue }
      if let path = item.payloadPath { try? manager.removeItem(at: container.appendingPathComponent(path)) }
    }
  }

  private func load(_ provider: NSItemProvider, title: String?, sharedContext: [String: Any]?) async throws -> FoundkeepShareItem? {
    let context: [String: Any]?
    if let sharedContext {
      context = sharedContext
    } else {
      context = try await webpageContext(provider)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) && provider.registeredTypeIdentifiers.allSatisfy({ $0 == UTType.propertyList.identifier }) { return nil }
    // Files also advertises URL representations. Choose its concrete payload,
    // never the bytes of public.file-url/public.url, regardless of type order.
    let fileTypes = provider.registeredTypeIdentifiers.compactMap(UTType.init).filter {
      !$0.conforms(to: .url) && ($0.conforms(to: .content) || $0.conforms(to: .data))
    }
    let fileType = fileTypes.first(where: {
      $0.conforms(to: .image) || $0.conforms(to: .movie) || $0.conforms(to: .audio) || $0.conforms(to: .pdf)
    }) ?? fileTypes.first(where: { $0.conforms(to: .content) }) ?? fileTypes.first
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier), let fileType {
      return try await copiedFile(provider, identifier: fileType.identifier, type: fileType, title: title, context: context)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), let url = try await value(provider, type: .url) as? URL {
      if url.isFileURL {
        guard let fileType else { throw FoundkeepItemError.unavailable }
        return try await copiedFile(provider, identifier: fileType.identifier, type: fileType, title: title, context: context)
      }
      return try bookmark(url, title: title, context: context)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), let text = try await value(provider, type: .plainText) as? String {
      guard policy.allows("selection") else { throw FoundkeepItemError.disabled }
      let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(policy.textCharacters))
      return FoundkeepShareItem(clientId: UUID().uuidString, type: "selection", sourceURL: context?["pageUrl"] as? String, sourceTitle: boundedTitle(title ?? context?["pageTitle"] as? String), selectionText: trimmed, fileName: nil, mime: nil, bytes: trimmed.utf8.count, payloadPath: nil, contentHash: hash(Data(trimmed.utf8)), pageContext: context)
    }
    guard let fileType else { return nil }
    return try await copiedFile(provider, identifier: fileType.identifier, type: fileType, title: title, context: context)
  }

  private func bookmark(_ url: URL, title: String?, context: [String: Any]?) throws -> FoundkeepShareItem {
    guard policy.allows("bookmark") else { throw FoundkeepItemError.disabled }
    let sourceURL = url.absoluteString
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
          sourceURL.utf16.count <= 4096 else { throw FoundkeepItemError.unavailable }
    return FoundkeepShareItem(clientId: UUID().uuidString, type: "bookmark", sourceURL: sourceURL, sourceTitle: boundedTitle(title ?? context?["pageTitle"] as? String), selectionText: context?["selectedText"] as? String, fileName: nil, mime: nil, bytes: 0, payloadPath: nil, contentHash: hash(Data(sourceURL.utf8)), pageContext: context)
  }

  private func copiedFile(_ provider: NSItemProvider, identifier: String, type: UTType, title: String?, context: [String: Any]?) async throws -> FoundkeepShareItem {
    let itemType = type.conforms(to: .image) ? "image" : type.conforms(to: .movie) ? "video" : type.conforms(to: .audio) ? "audio" : type.conforms(to: .pdf) ? "document" : "file"
    guard policy.allows(itemType) else { throw FoundkeepItemError.disabled }
    let directory = container.appendingPathComponent("payloads", isDirectory: true)
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    return try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: identifier) { source, error in
        guard let source, error == nil else { continuation.resume(throwing: error ?? FoundkeepItemError.unavailable); return }
        do {
          let attributes = try self.manager.attributesOfItem(atPath: source.path)
          let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
          guard size > 0 else { throw FoundkeepItemError.unavailable }
          guard size <= self.policy.fileBytes else { throw FoundkeepItemError.tooLarge }
          let suggested = self.safeName(provider.suggestedName ?? source.lastPathComponent, fallbackExtension: type.preferredFilenameExtension)
          let file = directory.appendingPathComponent("\(UUID().uuidString)-\(suggested)")
          try self.manager.copyItem(at: source, to: file)
          let relative = "payloads/\(file.lastPathComponent)"
          continuation.resume(returning: FoundkeepShareItem(clientId: UUID().uuidString, type: itemType, sourceURL: context?["pageUrl"] as? String, sourceTitle: self.boundedTitle(title ?? context?["pageTitle"] as? String), selectionText: nil, fileName: suggested, mime: type.preferredMIMEType ?? "application/octet-stream", bytes: size, payloadPath: relative, contentHash: self.hashFile(file), pageContext: context))
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  private func value(_ provider: NSItemProvider, type: UTType) async throws -> NSSecureCoding? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { value, error in
        if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value) }
      }
    }
  }

  private func webpageContext(_ provider: NSItemProvider) async throws -> [String: Any]? {
    guard provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) else { return nil }
    let result = try? await value(provider, type: .propertyList)
    guard let dictionary = result as? [String: Any] else { return nil }
    return dictionary[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any]
  }

  private func safeName(_ value: String, fallbackExtension: String?) -> String {
    var name = (value as NSString).lastPathComponent.components(separatedBy: .controlCharacters).joined().trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { name = "Shared file" }
    if (name as NSString).pathExtension.isEmpty, let fallbackExtension { name += ".\(fallbackExtension)" }
    return String(name.prefix(180))
  }

  private func boundedTitle(_ value: String?) -> String? {
    guard let value else { return nil }
    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return clean.isEmpty ? nil : String(clean.prefix(1000))
  }

  private func hash(_ data: Data) -> String { Data(SHA256.hash(data: data)).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
  private func hashFile(_ url: URL) -> String? {
    guard let stream = InputStream(url: url) else { return nil }
    stream.open(); defer { stream.close() }
    var digest = SHA256(); var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while stream.hasBytesAvailable { let read = stream.read(&buffer, maxLength: buffer.count); if read < 0 { return nil }; if read == 0 { break }; digest.update(data: Data(buffer[0..<read])) }
    return Data(digest.finalize()).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
