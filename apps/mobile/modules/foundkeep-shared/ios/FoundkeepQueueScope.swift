import Foundation

struct FoundkeepQueueSession: Equatable {
  let token: String
  let accountId: String
}

struct FoundkeepShareBatch {
  let id = UUID().uuidString
  private(set) var uploadedClientIds = Set<String>()

  func pendingItems<Item>(_ items: [Item], clientId: (Item) -> String) -> [Item] {
    items.filter { !uploadedClientIds.contains(clientId($0)) }
  }

  mutating func markUploaded(clientId: String) {
    uploadedClientIds.insert(clientId)
  }
}

enum FoundkeepQueueScope {
  static func organizationName(_ value: String, limit: Int) -> String? {
    let name = value.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
    guard !name.isEmpty, name.utf16.count <= limit,
          !name.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else { return nil }
    return name
  }

  static func accountId(from accountJSON: String) -> String? {
    guard let data = accountJSON.data(using: .utf8),
          let account = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = account["id"] as? String, !id.isEmpty else { return nil }
    return id
  }

  static func session(token: String?, boundAccountId: String?) -> FoundkeepQueueSession? {
    guard let token, !token.isEmpty, let boundAccountId, !boundAccountId.isEmpty else { return nil }
    return FoundkeepQueueSession(token: token, accountId: boundAccountId)
  }

  static func owns(_ ownerAccountId: String?, accountId: String?) -> Bool {
    guard let ownerAccountId, !ownerAccountId.isEmpty, let accountId, !accountId.isEmpty else { return false }
    return ownerAccountId == accountId
  }

  static func mayRetry(ownerAccountId: String?, requiresOrganizationReview: Bool?, accountId: String?) -> Bool {
    owns(ownerAccountId, accountId: accountId) && requiresOrganizationReview != true
  }

  static func needsFolderReview(required: Bool?, reason: String?) -> Bool {
    required == true && reason == "folder_not_found"
  }

  static func isMissingFolder(statusCode: Int, data: Data) -> Bool {
    guard statusCode == 404,
          let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return response["error"] as? String == "folder_not_found"
  }
}

struct FoundkeepPendingRecord: Codable {
  let id: String
  let clientId: String
  let batchId: String?
  let ownerAccountId: String?
  var metadata: [String: FoundkeepJSONValue]
  let payloadPath: String?
  var attempts: Int
  var nextAttemptAt: Double
  let createdAt: Double
  var requiresOrganizationReview: Bool?
  var organizationReviewReason: String?

  mutating func resolveFolderToUnfiled(for accountId: String) -> Bool {
    guard FoundkeepQueueScope.owns(ownerAccountId, accountId: accountId),
          FoundkeepQueueScope.needsFolderReview(required: requiresOrganizationReview, reason: organizationReviewReason) else { return false }
    metadata["folderId"] = .null
    requiresOrganizationReview = false
    organizationReviewReason = nil
    attempts = 0
    nextAttemptAt = 0
    return true
  }
}

enum FoundkeepJSONValue: Codable, Equatable {
  case string(String), number(Double), bool(Bool), object([String: FoundkeepJSONValue]), array([FoundkeepJSONValue]), null

  init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() { self = .null }
    else if let item = try? value.decode(Bool.self) { self = .bool(item) }
    else if let item = try? value.decode(Double.self) { self = .number(item) }
    else if let item = try? value.decode(String.self) { self = .string(item) }
    else if let item = try? value.decode([String: FoundkeepJSONValue].self) { self = .object(item) }
    else { self = .array(try value.decode([FoundkeepJSONValue].self)) }
  }
  func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .string(let item): try value.encode(item)
    case .number(let item): try value.encode(item)
    case .bool(let item): try value.encode(item)
    case .object(let item): try value.encode(item)
    case .array(let item): try value.encode(item)
    case .null: try value.encodeNil()
    }
  }
}

// Production's original directories and defaults keys remain untouched. Beta
// builds share the store identity but keep all local data under a dev namespace.
enum FoundkeepEnvironmentStorage {
  static var namespace: String { Bundle.main.object(forInfoDictionaryKey: "FoundkeepStorageNamespace") as? String == "dev" ? "dev" : "" }
  static func key(_ value: String) -> String { namespace.isEmpty ? value : "dev-\(value)" }
  static func container(_ value: URL) -> URL { namespace.isEmpty ? value : value.appendingPathComponent("dev", isDirectory: true) }
}
