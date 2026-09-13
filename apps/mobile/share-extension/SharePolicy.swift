import Foundation

struct FoundkeepSharePolicy {
  let capture: [String: Bool]
  let fileBytes: Int
  let textCharacters: Int
  let articleCharacters: Int
  let batchItems: Int
  let uploadTimeout: TimeInterval
  let notice: String?

  static let safeDefault = FoundkeepSharePolicy(
    capture: ["bookmark": true, "selection": true, "note": true, "image": true, "video": true, "audio": true, "document": true, "file": true],
    fileBytes: 50 * 1024 * 1024, textCharacters: 50_000, articleCharacters: 500_000, batchItems: 20, uploadTimeout: 15, notice: nil
  )

  static var current: FoundkeepSharePolicy {
    guard let raw = UserDefaults(suiteName: (Bundle.main.object(forInfoDictionaryKey: "FoundkeepAppGroup") as? String ?? "group.app.foundkeep.ios"))?.string(forKey: FoundkeepEnvironmentStorage.key("mobile-policy")),
          let data = raw.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          root["schemaVersion"] as? Int == 1,
          let minimumVersion = root["minimumVersion"] as? String, !requiresUpdate(current: "1.0.0", minimum: minimumVersion),
          let capture = root["capture"] as? [String: Bool], capture.count == safeDefault.capture.count,
          Set(capture.keys) == Set(safeDefault.capture.keys),
          let limits = root["limits"] as? [String: Any],
          let fileBytes = limits["fileBytes"] as? Int, (1024 * 1024...50 * 1024 * 1024).contains(fileBytes),
          let textCharacters = limits["textCharacters"] as? Int, (1_000...100_000).contains(textCharacters),
          let articleCharacters = limits["articleCharacters"] as? Int, (10_000...500_000).contains(articleCharacters),
          let batchItems = limits["batchItems"] as? Int, (1...20).contains(batchItems),
          let timeout = limits["uploadTimeoutSeconds"] as? Int, (5...30).contains(timeout)
    else { return safeDefault }
    let notice = (root["notice"] as? String).flatMap { $0.count <= 200 ? $0 : nil }
    return FoundkeepSharePolicy(capture: capture, fileBytes: fileBytes, textCharacters: textCharacters, articleCharacters: articleCharacters, batchItems: batchItems, uploadTimeout: TimeInterval(timeout), notice: notice)
  }

  private static func requiresUpdate(current: String, minimum: String) -> Bool {
    let a = current.split(separator: ".").compactMap { Int($0) }
    let b = minimum.split(separator: ".").compactMap { Int($0) }
    guard a.count == 3, b.count == 3 else { return true }
    for index in 0..<3 where a[index] != b[index] { return a[index] < b[index] }
    return false
  }

  func allows(_ type: String) -> Bool { capture[type] == true }
}
