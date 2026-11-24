// Turns frames/NNNNN.jpg + frames/times.json ([{f:"00001.jpg",t:seconds}...]) into an MP4 at constant 30 fps.
import AVFoundation
import AppKit
let a = CommandLine.arguments
guard a.count >= 4 else { print("usage: encode <framesDir> <out.mp4> <width>x<height> [fps]"); exit(1) }
let dir = a[1], out = a[2]
let wh = a[3].split(separator: "x").map { Int($0)! }
let W = wh[0], H = wh[1]
let fps = a.count > 4 ? Int(a[4])! : 30
struct F: Decodable { let f: String; let t: Double }
let frames = try JSONDecoder().decode([F].self, from: Data(contentsOf: URL(fileURLWithPath: dir + "/times.json")))
let end = (frames.last?.t ?? 0) + 1.0
try? FileManager.default.removeItem(atPath: out)
let w = try AVAssetWriter(url: URL(fileURLWithPath: out), fileType: .mp4)
let inp = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: Int(ProcessInfo.processInfo.environment["BITRATE"] ?? "3500000") ?? 3_500_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: inp, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
w.add(inp); w.startWriting(); w.startSession(atSourceTime: .zero)
var cur = -1; var img: CGImage? = nil
let total = Int(end * Double(fps))
for n in 0..<total {
  let t = Double(n) / Double(fps)
  var k = max(cur, 0); while k + 1 < frames.count && frames[k + 1].t <= t { k += 1 }
  if k != cur || img == nil {
    cur = k
    if let ns = NSImage(contentsOfFile: dir + "/" + frames[k].f), let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) { img = cg }
  }
  while !inp.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, ad.pixelBufferPool!, &pb)
  guard let buf = pb, let cg = img else { continue }
  CVPixelBufferLockBaseAddress(buf, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: W, height: H, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
  CVPixelBufferUnlockBaseAddress(buf, [])
  ad.append(buf, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: CMTimeScale(fps)))
}
inp.markAsFinished()
let sem = DispatchSemaphore(value: 0); w.finishWriting { sem.signal() }; sem.wait()
print(w.status == .completed ? "ok \(total) frames" : "failed \(String(describing: w.error))")
