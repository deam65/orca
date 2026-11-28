import Foundation

// Everything the shell decides before WebKit is involved: the session id it will accept, the
// requests it will answer, the map it builds from a manifest, and the policy header. Compiled and
// run without a device:
//
//   swiftc -O -o /tmp/mobile-web-shell-checks \
//     ios/MobileWebShellOrigin.swift ios/MobileWebShellGeneration.swift ios/MobileWebShellCsp.swift \
//     ios/MobileWebShellLoadState.swift ios/MobileWebShellResponseHeaders.swift \
//     ios/MobileWebShellBridge.swift ios/MobileWebShellAppliedProps.swift \
//     ios/MobileWebShellNavigationPolicy.swift ios/MobileWebShellChatVisualFrame.swift \
//     ios/MobileWebShellScreencastFrames.swift \
//     tests/MobileWebShellChecks.swift && /tmp/mobile-web-shell-checks
@main struct MobileWebShellChecks {
  static func manifest(
    schemaVersion: Int = 1,
    entrypoint: String = "index.html",
    assets: [[String: Any]] = [
      ["path": "index.html", "contentType": "text/html; charset=utf-8"],
      ["path": "assets/aa.js", "contentType": "text/javascript; charset=utf-8"],
      ["path": "assets/bb.png", "contentType": "image/png"]
    ]
  ) -> Data {
    let root: [String: Any] = [
      "schemaVersion": schemaVersion,
      "entrypoint": entrypoint,
      "assets": assets
    ]
    return try! JSONSerialization.data(withJSONObject: root)
  }

  static func generation(_ data: Data) -> MobileWebShellGeneration? {
    try? MobileWebShellGeneration.make(
      manifestData: data,
      directory: URL(fileURLWithPath: "/tmp/generation", isDirectory: true)
    )
  }


  static func checkGenerationMap() {
    guard let built = generation(manifest()) else { preconditionFailure("manifest rejected") }
    // Only / may serve document bytes with CSP; no entrypoint alias.
    precondition(built.entries["/index.html"] == nil)

    // The entrypoint must be one of the assets, or "/" would map to a file nobody declared.
    precondition(generation(manifest(assets: [
      ["path": "assets/aa.js", "contentType": "text/javascript; charset=utf-8"]
    ])) == nil)
    precondition(generation(manifest(assets: [
      ["path": "index.html", "contentType": "text/html; charset=utf-8"],
      ["path": "../escape.js", "contentType": "text/javascript; charset=utf-8"]
    ])) == nil)
    precondition(generation(manifest(assets: [
      ["path": "index.html", "contentType": "text/html; charset=utf-8"],
      ["path": "assets/aa.js", "contentType": "text/javascript\r\nX-Injected: 1"]
    ])) == nil)
    // NSNumber bridges JSON true and 1.0 to Int; neither satisfies the integer-1 contract.
    precondition(generation(Data(#"{"schemaVersion":true,"entrypoint":"index.html","assets":[{"path":"index.html","contentType":"text/html"}]}"#.utf8)) == nil)
    precondition(generation(Data(#"{"schemaVersion":1.0,"entrypoint":"index.html","assets":[{"path":"index.html","contentType":"text/html"}]}"#.utf8)) == nil)
  }


  static func checkLoadStateMachine() {
    // replaceState rewrites the URL before finish; readiness must depend on commit state.
    let unseated = MobileWebShellLoadStateMachine()
    _ = unseated.started()
    precondition(unseated.finished() == nil)
    unseated.committed()
    precondition(unseated.finished()?.state == "ready")

    // A rule list compiles asynchronously, so it can fail after the generation was already refused.
    let refused = MobileWebShellLoadStateMachine()
    precondition(refused.failed(.generationUnreadable)?.reason == "generation-unreadable")
    precondition(refused.failed(.isolationUnavailable) == nil)
    precondition(refused.failed(.renderProcessGone) == nil)
    precondition(refused.started() == nil)

    refused.reset()
    precondition(refused.failed(.generationUnreadable)?.reason == "generation-unreadable")

    // A document is heard only between its own commit and the end of that load.
    let arming = MobileWebShellLoadStateMachine()
    _ = arming.started()
    // The previous document is alive and same-origin until the next one commits.
    precondition(!arming.hasCommittedDocument)
    arming.committed()
    precondition(arming.hasCommittedDocument)

    // A new prop triple: the committed document is the one being replaced.
    arming.reset()
    precondition(!arming.hasCommittedDocument)
    arming.committed()
    arming.documentEnded()
    precondition(!arming.hasCommittedDocument)

    // A failure ends the document, and nothing after it re-arms: a retry is a remount.
    arming.committed()
    _ = arming.failed(.renderProcessGone)
    precondition(!arming.hasCommittedDocument)
    arming.committed()
    precondition(!arming.hasCommittedDocument)
  }

  static func checkScreencastFrameStore() {
    let validStreamId = "abcdeFGHIJklmnopQRSTuv" // exactly 22 chars, alphanumeric/_/-
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/0")?.streamId == validStreamId)
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/0")?.frameSeq == 0)
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/999")?.frameSeq == 999)

    // Path rejections
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/short/0") == nil)
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/-1") == nil)
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/01") == nil) // leading zero
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/12345678901") == nil) // >10 digits
    precondition(MobileWebShellScreencastFrameStore.parsePath("/__orca_screencast/\(validStreamId)/abc") == nil)

    let store = MobileWebShellScreencastFrameStore(
      maxFramesPerStream: 2,
      maxStreams: 2,
      maxFrameBytes: 100,
      maxTotalBytes: 180
    )

    let dummyData = Data(repeating: 0xFF, count: 50)
    let path0 = store.stage(streamId: validStreamId, frameSeq: 0, mimeType: "image/jpeg", data: dummyData)
    precondition(path0 == "/__orca_screencast/\(validStreamId)/0")

    let readRes = store.read(path: path0!)
    precondition(readRes?.mimeType == "image/jpeg")
    precondition(readRes?.data.count == 50)

    // Bad mime type or size
    precondition(store.stage(streamId: validStreamId, frameSeq: 1, mimeType: "image/gif", data: dummyData) == nil)
    precondition(store.stage(streamId: validStreamId, frameSeq: 1, mimeType: "image/png", data: Data()) == nil)
    precondition(store.stage(streamId: validStreamId, frameSeq: 1, mimeType: "image/png", data: Data(repeating: 0, count: 101)) == nil)

    // FIFO cap per stream (max 2)
    let _ = store.stage(streamId: validStreamId, frameSeq: 1, mimeType: "image/png", data: dummyData)
    let _ = store.stage(streamId: validStreamId, frameSeq: 2, mimeType: "image/png", data: dummyData)
    // frameSeq 0 should be evicted now
    precondition(store.read(path: "/__orca_screencast/\(validStreamId)/0") == nil)
    precondition(store.read(path: "/__orca_screencast/\(validStreamId)/1") != nil)
    precondition(store.read(path: "/__orca_screencast/\(validStreamId)/2") != nil)

    // clearStream
    store.clearStream(streamId: validStreamId)
    precondition(store.read(path: "/__orca_screencast/\(validStreamId)/2") == nil)

    // clearAll
    let _ = store.stage(streamId: validStreamId, frameSeq: 0, mimeType: "image/jpeg", data: dummyData)
    store.clearAll()
    precondition(store.read(path: "/__orca_screencast/\(validStreamId)/0") == nil)

    // Response headers: immutable cache for screencast URLs, no-store for document and static assets.
    let frameHeaders = MobileWebShellResponseHeaders.forPath(
      "/__orca_screencast/\(validStreamId)/1",
      contentType: "image/jpeg",
      byteCount: 10
    )
    precondition(frameHeaders["Cache-Control"] == "private, max-age=60, immutable")
    let docHeaders = MobileWebShellResponseHeaders.forPath(
      "/",
      contentType: "text/html",
      byteCount: 10
    )
    precondition(docHeaders["Cache-Control"] == "no-store")

    // Session registry lookup, staging, clear, and identity-checked unregister.
    let regStore = MobileWebShellScreencastFrameStore()
    let registry = MobileWebShellScreencastSessionRegistry()
    registry.register(sessionId: "session-check", store: regStore)
    let regPath = registry.stage(
      sessionId: "session-check",
      streamId: validStreamId,
      frameSeq: 1,
      mimeType: "image/jpeg",
      data: dummyData
    )
    precondition(regPath == "/__orca_screencast/\(validStreamId)/1")
    precondition(regStore.read(path: regPath!)?.data.count == 50)
    registry.clear(sessionId: "session-check", streamId: validStreamId)
    precondition(regStore.read(path: regPath!) == nil)
    registry.unregister(sessionId: "session-check", store: regStore)
    precondition(
      registry.stage(
        sessionId: "session-check",
        streamId: validStreamId,
        frameSeq: 2,
        mimeType: "image/jpeg",
        data: dummyData
      ) == nil
    )
  }



  static func main() {
    checkGenerationMap()
    checkLoadStateMachine()
    checkScreencastFrameStore()
    print("mobile web shell checks OK")
  }
}
