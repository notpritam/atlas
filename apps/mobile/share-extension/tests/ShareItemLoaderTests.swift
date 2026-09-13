import Foundation
import UniformTypeIdentifiers

@main
struct ShareItemLoaderTests {
  static func main() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let loader = try ShareItemLoader(container: directory, policy: .safeDefault)
    func page(_ url: String) -> NSItemProvider {
      NSItemProvider(item: [NSExtensionJavaScriptPreprocessingResultsKey: ["pageUrl": url, "pageTitle": "Safari article", "readableText": "An article worth keeping."]] as NSDictionary, typeIdentifier: UTType.propertyList.identifier)
    }
    func input(_ providers: [NSItemProvider]) -> NSExtensionItem {
      let value = NSExtensionItem(); value.attachments = providers; return value
    }
    let items = try await loader.load([input([page("https://example.com/article")])])
    precondition(items.count == 1 && items[0].type == "bookmark", "Safari's property-list-only handoff must create one bookmark")
    precondition(items[0].sourceURL == "https://example.com/article" && items[0].sourceTitle == "Safari article", "Keep the original page identity")
    precondition(items[0].pageContext?["readableText"] as? String == "An article worth keeping.", "Keep the saved article content")
    let combined = try await loader.load([input([page("https://example.com/article"), NSItemProvider(item: URL(string: "https://example.com/article")! as NSURL, typeIdentifier: UTType.url.identifier)])])
    precondition(combined.count == 1, "A URL attachment and its preprocessing context must not create duplicates")
    for url in ["file:///private/example", "javascript:alert(1)", "https://user:password@example.com", "https:///", "https://example.com/" + String(repeating: "x", count: 4096)] {
      do { _ = try await loader.load([input([page(url)])]); preconditionFailure("Reject unsafe or malformed fallback URLs") }
      catch FoundkeepItemError.unavailable { }
    }
    var capture = FoundkeepSharePolicy.safeDefault.capture; capture["bookmark"] = false
    let disabled = FoundkeepSharePolicy(capture: capture, fileBytes: 1024, textCharacters: 1000, articleCharacters: 10000, batchItems: 20, uploadTimeout: 15, notice: nil)
    do { _ = try await ShareItemLoader(container: directory, policy: disabled).load([input([page("https://example.com")])]); preconditionFailure("Fallback must respect the bookmark feature policy") }
    catch FoundkeepItemError.disabled { }
    print("Passed 10 native Safari item-loader checks.")
    try await fileChecks(directory: directory)
  }


  private struct FileFixture {
    let name: String
    let type: String
    let mime: String
    let hash: String
    let data: Data
  }

  // Change registration order only; Foundation still vends the real file bytes.
  private final class URLFirstProvider: NSItemProvider, @unchecked Sendable {
    override var registeredTypeIdentifiers: [String] {
      super.registeredTypeIdentifiers.sorted {
        let firstURL = UTType($0)?.conforms(to: .url) == true
        let secondURL = UTType($1)?.conforms(to: .url) == true
        return firstURL && !secondURL
      }
    }
  }

  private static func fileChecks(directory: URL) async throws {
    let fixtures = [
      FileFixture(name: "Original.png", type: "image", mime: "image/png", hash: "jVn4dklfkvAxFeSgwmyxgzKnCn_aQL0plnAqyGy2QPE", data: Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAAj0lEQVR4nO3RMREAIBDAsFeBD/y7wBDIYGiG7r3LnL2u/jW/B+oBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQLsHCn9C7wyRpaEAAAAASUVORK5CYII=")!),
      FileFixture(name: "Original.pdf", type: "document", mime: "application/pdf", hash: "sxAp9jbI1S06UBGEgVb-TCqFsOtRlIKX5ita1VMcTnI", data: Data(base64Encoded: "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTgwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggOTAgPj4Kc3RyZWFtCkJUIC9GMSAxNiBUZiAyNCAxMjAgVGQgKEZvdW5ka2VlcCBpT1MgbWVkaWEgUUEpIFRqIDAgLTI0IFRkIChEaXNwb3NhYmxlIFBERiBmaXh0dXJlKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDUxCiUlRU9GCg==")!),
      FileFixture(name: "Original.mp4", type: "video", mime: "video/mp4", hash: "EbJATAfYe5JRMIwO1-VnFVSuSegyqHahGSvoTwdeDNY", data: Data(base64Encoded: "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAjabW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAACsRAABWIgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAA6B0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAABWIgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAViIAAAIAAABAAAAAAMYbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACw21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAoNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAYABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UKNsBEAAAMAAQAAAwAUDxIllgEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAQQAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAFAAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAKhjdHRzAAAAAAAAABMAAAABAAAIAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAEAAAAAACAAAEAAAAAChzdHNjAAAAAAAAAAIAAAABAAAAAgAAAAEAAAACAAAAAQAAAAEAAABkc3RzegAAAAAAAAAAAAAAFAAAAusAAAAQAAAADQAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAADwAAAA0AAAANAAAAFQAAAA8AAAANAAAAXHN0Y28AAAAAAAAAEwAACQoAAAwYAAAMOQAADFYAAAxzAAAMnQAADLwAAAzZAAAM+gAADSAAAA0/AAANYAAADX0AAA2jAAANwgAADeMAAA4AAAAOJQAADkgAAARldHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAgAAAAAAAVgAAAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAFYAAAABAAAAQAAAAAD3W1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAArEQAAVwAVcQAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAA4htaW5mAAAAEHNtaGQAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAA0xzdGJsAAAAfnN0c2QAAAAAAAAAAQAAAG5tcDRhAAAAAAAAAAEAAAAAAAAAAAABABAAAAAArEQAAAAAADZlc2RzAAAAAAOAgIAlAAIABICAgBdAFQAAAAABDYgAAAWdBYCAgAUSCFblAAaAgIABAgAAABRidHJ0AAAAAAABDYgAAAWdAAAAGHN0dHMAAAAAAAAAAQAAAFcAAAQAAAAArHN0c2MAAAAAAAAADQAAAAEAAAABAAAAAQAAAAIAAAAFAAAAAQAAAAMAAAAEAAAAAQAAAAUAAAAFAAAAAQAAAAYAAAAEAAAAAQAAAAgAAAAFAAAAAQAAAAkAAAAEAAAAAQAAAAsAAAAFAAAAAQAAAAwAAAAEAAAAAQAAAA8AAAAFAAAAAQAAABAAAAAEAAAAAQAAABIAAAAFAAAAAQAAABMAAAAMAAAAAQAAAXBzdHN6AAAAAAAAAAAAAABXAAAAEwAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAAXHN0Y28AAAAAAAAAEwAADAUAAAwlAAAMRgAADGMAAAyJAAAMrAAADMkAAAzmAAANEAAADS8AAA1MAAANbQAADZMAAA2yAAANzwAADfAAAA4VAAAONAAADlUAAAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAVwAAAAEAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAAACGZyZWUAAAWDbWRhdAAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0zIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAADVliIQAEf/+5+P8CmhqRxLr1QHBqptdyoujXh1cYhTyC6u2OqN+Hdwy1OBQfXYESAAXsGvrwQAAAAxBmiRsQR/+tSqAHjDcAExhdmM2My4xLjEwMQACMEAOAAAACUGeQniHfwBoQQEYIAcBGCAHARggBwEYIAcBGCAHAAAACQGeYXRDfwCUgAEYIAcBGCAHARggBwEYIAcAAAAJAZ5jakN/AJSBARggBwEYIAcBGCAHARggBwAAABJBmmhJqEFomUwII//+tSqAHjEBGCAHARggBwEYIAcBGCAHARggBwAAAAtBnoZFESw7/wBoQQEYIAcBGCAHARggBwEYIAcAAAAJAZ6ldEN/AJSBARggBwEYIAcBGCAHARggBwAAAAkBnqdqQ38AlIABGCAHARggBwEYIAcBGCAHARggBwAAABJBmqxJqEFsmUwIIf/+qlUAPGABGCAHARggBwEYIAcBGCAHAAAAC0GeykUVLDv/AGhBARggBwEYIAcBGCAHARggBwAAAAkBnul0Q38AlIABGCAHARggBwEYIAcBGCAHARggBwAAAAkBnutqQ38AlIABGCAHARggBwEYIAcBGCAHAAAAEkGa8EmoQWyZTAh///6plgDmgQEYIAcBGCAHARggBwEYIAcAAAALQZ8ORRUsO/8AaEEBGCAHARggBwEYIAcBGCAHAAAACQGfLXRDfwCUgQEYIAcBGCAHARggBwEYIAcBGCAHAAAACQGfL2pDfwCUgAEYIAcBGCAHARggBwEYIAcAAAARQZszSahBbJlMCG///qeEAccBGCAHARggBwEYIAcBGCAHAAAAC0GfUUUVLDf/AJSBARggBwEYIAcBGCAHARggBwEYIAcAAAAJAZ9yakN/AJSAARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAH")!)
    ]
    let inputDirectory = directory.appendingPathComponent("originals", isDirectory: true)
    let outputDirectory = directory.appendingPathComponent("copies", isDirectory: true)
    try FileManager.default.createDirectory(at: inputDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    for fixture in fixtures { try fixture.data.write(to: inputDirectory.appendingPathComponent(fixture.name)) }
    let loader = try ShareItemLoader(container: outputDirectory, policy: .safeDefault)
    func input(_ selected: [FileFixture], urlFirst: Bool = false) -> NSExtensionItem {
      let value = NSExtensionItem()
      value.attachments = selected.map { fixture in
        let url = inputDirectory.appendingPathComponent(fixture.name)
        let provider = urlFirst ? URLFirstProvider(contentsOf: url)! : NSItemProvider(contentsOf: url)!
        // contentsOf supplies a generic name on macOS. Supply the original
        // filename explicitly as file-share metadata for this provider fixture.
        provider.suggestedName = fixture.name
        return provider
      }
      return value
    }
    func check(_ valid: Bool, _ message: String) throws {
      if !valid { throw NSError(domain: "ShareItemLoaderTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    func verify(_ item: FoundkeepShareItem, fixture: FileFixture) throws {
      try check(item.type == fixture.type, "A local file must retain its media type: got \(item.type); expected \(fixture.type)")
      try check(item.fileName == fixture.name && item.mime == fixture.mime, "Preserve original filename and MIME: got \(item.fileName ?? "nil") / \(item.mime ?? "nil"); expected \(fixture.name) / \(fixture.mime)")
      try check(item.bytes == fixture.data.count && item.contentHash == fixture.hash, "Preserve actual byte count and hash")
      try check(item.sourceURL == nil && item.selectionText == nil, "A file URL must not become a bookmark or text")
      guard let path = item.payloadPath else { throw NSError(domain: "ShareItemLoaderTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Copy the original payload"]) }
      let copied = try Data(contentsOf: outputDirectory.appendingPathComponent(path))
      try check(copied == fixture.data, "Copy the exact original bytes")
    }
    var failures: [String] = []
    for fixture in fixtures {
      let original = inputDirectory.appendingPathComponent(fixture.name)
      let provider = NSItemProvider(item: original as NSURL, typeIdentifier: UTType.url.identifier)
      provider.suggestedName = fixture.name
      provider.registerFileRepresentation(forTypeIdentifier: UTType(filenameExtension: original.pathExtension)!.identifier, fileOptions: [], visibility: .all) { completion in
        completion(original, false, nil)
        return nil
      }
      let value = NSExtensionItem(); value.attachments = [provider]
      do {
        let items = try await loader.load([value])
        precondition(items.count == 1, "A local NSURL plus content creates one file")
        try verify(items[0], fixture: fixture)
        loader.discard(items)
        print("PASS local NSURL plus content: \(fixture.name)")
      } catch { failures.append("Local NSURL plus \(fixture.name): \(error.localizedDescription)") }
    }
    for fixture in fixtures {
      for urlFirst in [false, true] {
        do {
          let items = try await loader.load([input([fixture], urlFirst: urlFirst)])
          precondition(items.count == 1, "One file creates one item")
          try verify(items[0], fixture: fixture)
          loader.discard(items)
          print("PASS file \(fixture.name), URL-first=\(urlFirst)")
        } catch {
          failures.append("\(fixture.name), URL-first=\(urlFirst): \(error.localizedDescription)")
        }
      }
    }
    do {
      let batch = try await loader.load([input(fixtures)])
      precondition(batch.count == 3, "Keep all three files in the mixed batch")
      for (item, fixture) in zip(batch, fixtures) { try verify(item, fixture: fixture) }
      loader.discard(batch)
      print("PASS mixed PNG/PDF/MP4 batch")
    } catch { failures.append("Mixed batch: \(error.localizedDescription)") }
    var capture = FoundkeepSharePolicy.safeDefault.capture
    capture["image"] = false
    let disabled = FoundkeepSharePolicy(capture: capture, fileBytes: 1024, textCharacters: 1000, articleCharacters: 10000, batchItems: 20, uploadTimeout: 15, notice: nil)
    do {
      _ = try await ShareItemLoader(container: outputDirectory, policy: disabled).load([input([fixtures[0]])])
      failures.append("Disabled image unexpectedly accepted")
    } catch FoundkeepItemError.disabled { print("PASS disabled file media policy") }
    catch { failures.append("Disabled image threw the wrong error: \(error.localizedDescription)") }
    let limited = FoundkeepSharePolicy(capture: FoundkeepSharePolicy.safeDefault.capture, fileBytes: 199, textCharacters: 1000, articleCharacters: 10000, batchItems: 2, uploadTimeout: 15, notice: nil)
    do {
      _ = try await ShareItemLoader(container: outputDirectory, policy: limited).load([input([fixtures[0]])])
      failures.append("Oversize image unexpectedly accepted")
    } catch FoundkeepItemError.tooLarge { print("PASS file byte limit") }
    catch { failures.append("Oversize image threw the wrong error: \(error.localizedDescription)") }
    let batchLimited = FoundkeepSharePolicy(capture: FoundkeepSharePolicy.safeDefault.capture, fileBytes: 5000, textCharacters: 1000, articleCharacters: 10000, batchItems: 2, uploadTimeout: 15, notice: nil)
    do {
      let items = try await ShareItemLoader(container: outputDirectory, policy: batchLimited).load([input(fixtures)])
      precondition(items.count == 2, "Respect the mixed-file batch limit")
      for (item, fixture) in zip(items, fixtures) { try verify(item, fixture: fixture) }
      loader.discard(items)
      print("PASS mixed-file batch limit")
    } catch { failures.append("Batch limit: \(error.localizedDescription)") }
    for failure in failures { print("FAIL \(failure)") }
    if !failures.isEmpty { exit(1) }
    print("Passed 13 native file item-loader cases.")
  }
}
