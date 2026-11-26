import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct CropBox: Decodable {
    let measure: String
    let index: Int
    let page: Int
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

func stderr(_ msg: String) {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
}

guard CommandLine.arguments.count >= 4 else {
    stderr("Usage: crop_measures <pdf_path> <boxes_json_path> <out_dir> [dpi]")
    exit(2)
}

let pdfPath = CommandLine.arguments[1]
let boxesJsonPath = CommandLine.arguments[2]
let outDir = CommandLine.arguments[3]
let dpi = CommandLine.arguments.count >= 5 ? (Double(CommandLine.arguments[4]) ?? 220.0) : 220.0

guard let pdfDoc = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    stderr("Failed to open PDF: \(pdfPath)")
    exit(1)
}

let jsonData = try Data(contentsOf: URL(fileURLWithPath: boxesJsonPath))
let boxes = try JSONDecoder().decode([CropBox].self, from: jsonData)

try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

var byPage: [Int: [CropBox]] = [:]
for b in boxes {
    byPage[b.page, default: []].append(b)
}

func scoreStaffLines(page: PDFPage) -> Int {
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 150.0 / 72.0
    let w = max(1, Int(bounds.width * scale))
    let h = max(1, Int(bounds.height * scale))
    let cs = CGColorSpaceCreateDeviceGray()
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: cs, bitmapInfo: 0),
          let raw = ctx.data else { return 0 }
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    let data = raw.assumingMemoryBound(to: UInt8.self)
    var rowFrac = [Double](repeating: 0.0, count: h)
    let x0 = w / 6
    let x1 = (5 * w) / 6
    let span = Double(max(1, x1 - x0))
    for y in 0..<h {
        var dark = 0
        let off = y * w
        for x in x0..<x1 {
            if data[off + x] < 160 { dark += 1 }
        }
        rowFrac[y] = Double(dark) / span
    }
    var staffRows = 0
    for y in 2..<(h - 2) {
        if rowFrac[y] > 0.38 && (rowFrac[y - 2] < 0.22 || rowFrac[y + 2] < 0.22) {
            staffRows += 1
        }
    }
    return staffRows
}

let neededPages = byPage.keys.sorted()
let maxXmlPage = neededPages.last ?? 0
var pageMap: [Int: Int] = [:] // xmlPage (1-based) -> pdfPageIdx (0-based)
if maxXmlPage > 0 && maxXmlPage < pdfDoc.pageCount {
    var scored: [(idx: Int, score: Int)] = []
    for i in 0..<pdfDoc.pageCount {
        if let p = pdfDoc.page(at: i) {
            scored.append((i, scoreStaffLines(page: p)))
        }
    }
    // Prefer best contiguous block of maxXmlPage pages if it captures nearly all staff score
    let bestTopIndices = scored.sorted { $0.score > $1.score }.prefix(maxXmlPage).map { $0.idx }.sorted()
    for (offset, xmlPg) in (1...maxXmlPage).enumerated() where offset < bestTopIndices.count {
        pageMap[xmlPg] = bestTopIndices[offset]
    }
} else {
    for xmlPg in neededPages {
        pageMap[xmlPg] = xmlPg - 1
    }
}

var croppedCount = 0
let scale = CGFloat(dpi / 72.0)

for pageNum in neededPages {
    let pageIdx = pageMap[pageNum] ?? (pageNum - 1)
    guard pageIdx >= 0 && pageIdx < pdfDoc.pageCount, let page = pdfDoc.page(at: pageIdx) else {
        stderr("Skipping out-of-range page \(pageNum)")
        continue
    }

    let bounds = page.bounds(for: .mediaBox)
    let pxW = max(1, Int(ceil(bounds.width * scale)))
    let pxH = max(1, Int(ceil(bounds.height * scale)))

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
              data: nil,
              width: pxW,
              height: pxH,
              bitsPerComponent: 8,
              bytesPerRow: 0,
              space: colorSpace,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else {
        stderr("Failed to create CGContext for page \(pageNum)")
        continue
    }

    ctx.setFillColor(CGColor.white)
    ctx.fill(CGRect(x: 0, y: 0, width: pxW, height: pxH))
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    guard let fullImg = ctx.makeImage() else {
        stderr("Failed to rasterize page \(pageNum)")
        continue
    }

    for box in byPage[pageNum] ?? [] {
        let rx = max(0.0, min(Double(pxW - 1), box.x * Double(pxW)))
        let ry = max(0.0, min(Double(pxH - 1), box.y * Double(pxH)))
        let rw = max(1.0, min(Double(pxW) - rx, box.w * Double(pxW)))
        let rh = max(1.0, min(Double(pxH) - ry, box.h * Double(pxH)))
        let rect = CGRect(x: floor(rx), y: floor(ry), width: ceil(rw), height: ceil(rh))
        guard let crop = fullImg.cropping(to: rect) else { continue }

        let filename = String(format: "m%03d.png", box.index + 1)
        let outUrl = URL(fileURLWithPath: outDir).appendingPathComponent(filename)
        guard let dest = CGImageDestinationCreateWithURL(outUrl as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            continue
        }
        CGImageDestinationAddImage(dest, crop, nil)
        if CGImageDestinationFinalize(dest) {
            croppedCount += 1
        }
    }
}

let summary: [String: Any] = [
    "cropped": croppedCount,
    "pages": byPage.keys.count,
    "pageMap": Dictionary(uniqueKeysWithValues: pageMap.map { (String($0.key), $0.value + 1) }),
    "outDir": outDir
]
let outJson = try JSONSerialization.data(withJSONObject: summary, options: [])
print(String(data: outJson, encoding: .utf8) ?? "{}")
