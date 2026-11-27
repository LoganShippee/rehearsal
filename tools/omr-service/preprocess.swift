import AppKit
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import PDFKit

private func writePNG(_ image: CGImage, to url: URL) -> Bool {
    guard let dest = CGImageDestinationCreateWithURL(
        url as CFURL,
        "public.png" as CFString,
        1,
        nil
    ) else {
        return false
    }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest)
}

private func renderPDFPageToCGImage(_ page: PDFPage, dpi: Double, contrast: Bool = false) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0 && bounds.height > 0 else { return nil }
    let scale = max(1.0, dpi / 72.0)
    let width = max(1, Int((bounds.width * scale).rounded()))
    let height = max(1, Int((bounds.height * scale).rounded()))

    guard let colorSpace = CGColorSpace(name: CGColorSpace.genericGrayGamma2_2),
          let ctx = CGContext(
              data: nil,
              width: width,
              height: height,
              bitsPerComponent: 8,
              bytesPerRow: 0,
              space: colorSpace,
              bitmapInfo: CGImageAlphaInfo.none.rawValue
          ) else {
        return nil
    }

    ctx.interpolationQuality = .high
    ctx.setFillColor(gray: 1.0, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

    ctx.saveGState()
    ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    guard let rawCG = ctx.makeImage() else { return nil }
    if contrast {
        return enhanceCIImage(CIImage(cgImage: rawCG), deskew: false) ?? rawCG
    }
    return rawCG
}

private func renderPDFPage(_ page: PDFPage, dpi: Double, to url: URL) -> Bool {
    guard let cgImage = renderPDFPageToCGImage(page, dpi: dpi, contrast: false) else {
        return false
    }
    return writePNG(cgImage, to: url)
}

private func writeRasterPDF(doc: PDFDocument, to outURL: URL, dpi: Double, contrast: Bool) -> Bool {
    let count = doc.pageCount
    guard count > 0, let firstPage = doc.page(at: 0) else { return false }
    let firstBounds = firstPage.bounds(for: .mediaBox)
    var initBox = CGRect(x: 0, y: 0, width: max(1, firstBounds.width), height: max(1, firstBounds.height))
    guard let pdfCtx = CGContext(outURL as CFURL, mediaBox: &initBox, nil) else {
        return false
    }

    for idx in 0..<count {
        guard let page = doc.page(at: idx),
              let cgImage = renderPDFPageToCGImage(page, dpi: dpi, contrast: contrast) else {
            pdfCtx.closePDF()
            return false
        }
        let bounds = page.bounds(for: .mediaBox)
        let pageBox = CGRect(x: 0, y: 0, width: max(1, bounds.width), height: max(1, bounds.height))
        let pageInfo: [CFString: Any] = [
            kCGPDFContextMediaBox: pageBox.dictionaryRepresentation
        ]
        pdfCtx.beginPDFPage(pageInfo as CFDictionary)
        pdfCtx.interpolationQuality = .high
        pdfCtx.draw(cgImage, in: pageBox)
        pdfCtx.endPDFPage()
    }
    pdfCtx.closePDF()
    return true
}

private func runPDF(args: [String]) -> Int32 {
    guard args.count >= 3 else {
        fputs("Usage: rehearsal-omr-prep pdf <input.pdf> <out_dir> <dpi> [page_num]\n", stderr)
        return 2
    }
    let inputURL = URL(fileURLWithPath: args[0])
    let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
    let dpi = Double(args[2]) ?? 350.0
    let singlePage: Int? = args.count >= 4 ? Int(args[3]) : nil

    guard let doc = PDFDocument(url: inputURL) else {
        fputs("Failed to open PDF: \(inputURL.path)\n", stderr)
        return 1
    }
    let count = doc.pageCount
    guard count > 0 else {
        fputs("PDF has 0 pages\n", stderr)
        return 1
    }

    do {
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    } catch {
        fputs("Failed to create output dir: \(error)\n", stderr)
        return 1
    }

    if let target = singlePage {
        guard target >= 1 && target <= count, let page = doc.page(at: target - 1) else {
            fputs("Invalid page number \(target) (pageCount=\(count))\n", stderr)
            return 1
        }
        let outURL = outDir.appendingPathComponent(String(format: "page-%04d.png", target))
        return renderPDFPage(page, dpi: dpi, to: outURL) ? 0 : 1
    }

    for idx in 0..<count {
        guard let page = doc.page(at: idx) else { continue }
        let outURL = outDir.appendingPathComponent(String(format: "page-%04d.png", idx + 1))
        if !renderPDFPage(page, dpi: dpi, to: outURL) {
            fputs("Failed to render page \(idx + 1)\n", stderr)
            return 1
        }
    }
    return 0
}

private func rowVarianceScore(_ cgImage: CGImage) -> Double {
    let w = cgImage.width
    let h = cgImage.height
    guard w > 8, h > 8,
          let space = CGColorSpace(name: CGColorSpace.genericGrayGamma2_2),
          let ctx = CGContext(
              data: nil,
              width: w,
              height: h,
              bitsPerComponent: 8,
              bytesPerRow: w,
              space: space,
              bitmapInfo: CGImageAlphaInfo.none.rawValue
          ) else {
        return 0.0
    }
    ctx.setFillColor(gray: 1.0, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let dataPtr = ctx.data else { return 0.0 }
    let buf = dataPtr.assumingMemoryBound(to: UInt8.self)
    var rowMeans = [Double](repeating: 0.0, count: h)
    var totalMean = 0.0
    for y in 0..<h {
        let rowOff = y * w
        var sum = 0
        for x in 0..<w {
            sum += Int(buf[rowOff + x])
        }
        let m = Double(sum) / Double(w)
        rowMeans[y] = m
        totalMean += m
    }
    totalMean /= Double(h)
    var variance = 0.0
    for m in rowMeans {
        let d = m - totalMean
        variance += d * d
    }
    return variance / Double(h)
}

private func rotateCIImage(_ image: CIImage, degrees: Double, context: CIContext) -> CIImage {
    let ext = image.extent
    guard !ext.isEmpty, abs(degrees) > 1e-4 else { return image }
    let rad = degrees * Double.pi / 180.0
    let cx = ext.midX
    let cy = ext.midY
    var xform = CGAffineTransform(translationX: cx, y: cy)
    xform = xform.rotated(by: CGFloat(rad))
    xform = xform.translatedBy(x: -cx, y: -cy)
    let rotated = image.transformed(by: xform)
    let white = CIImage(color: CIColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0)).cropped(to: ext)
    if let comp = CIFilter(name: "CISourceOverCompositing") {
        comp.setValue(rotated, forKey: kCIInputImageKey)
        comp.setValue(white, forKey: kCIInputBackgroundImageKey)
        if let out = comp.outputImage {
            return out.cropped(to: ext)
        }
    }
    return rotated.cropped(to: ext)
}

private func deskewIfNeeded(_ image: CIImage, context: CIContext) -> CIImage {
    let ext = image.extent
    guard ext.width >= 200, ext.height >= 200 else { return image }
    let scale = min(1.0, 500.0 / Double(ext.width))
    let small = image.transformed(by: CGAffineTransform(scaleX: CGFloat(scale), y: CGFloat(scale)))
    guard let smallCG0 = context.createCGImage(small, from: small.extent) else { return image }
    let baseScore = rowVarianceScore(smallCG0)
    guard baseScore > 0 else { return image }

    var bestAngle = 0.0
    var bestScore = baseScore
    var angle = -4.0
    while angle <= 4.001 {
        if abs(angle) >= 0.2 {
            let cand = rotateCIImage(small, degrees: angle, context: context)
            if let cg = context.createCGImage(cand, from: small.extent) {
                let sc = rowVarianceScore(cg)
                if sc > bestScore {
                    bestScore = sc
                    bestAngle = angle
                }
            }
        }
        angle += 0.25
    }
    if abs(bestAngle) >= 0.35 && bestScore >= baseScore * 1.10 {
        return rotateCIImage(image, degrees: bestAngle, context: context)
    }
    return image
}

private func enhanceCIImage(_ srcImage: CIImage, deskew: Bool = false) -> CGImage? {
    let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    var current = srcImage
    if let colorControls = CIFilter(name: "CIColorControls") {
        colorControls.setValue(current, forKey: kCIInputImageKey)
        colorControls.setValue(0.0, forKey: kCIInputSaturationKey)
        colorControls.setValue(1.0, forKey: kCIInputContrastKey)
        colorControls.setValue(0.0, forKey: kCIInputBrightnessKey)
        if let out = colorControls.outputImage {
            current = out
        }
    }
    if deskew {
        current = deskewIfNeeded(current, context: ciContext)
    }
    if let hs = CIFilter(name: "CIHighlightShadowAdjust") {
        hs.setValue(current, forKey: kCIInputImageKey)
        hs.setValue(0.45, forKey: "inputShadowAmount")
        hs.setValue(1.0, forKey: "inputHighlightAmount")
        if let out = hs.outputImage {
            current = out
        }
    }
    if let colorControls = CIFilter(name: "CIColorControls") {
        colorControls.setValue(current, forKey: kCIInputImageKey)
        colorControls.setValue(0.0, forKey: kCIInputSaturationKey)
        colorControls.setValue(1.20, forKey: kCIInputContrastKey)
        colorControls.setValue(0.02, forKey: kCIInputBrightnessKey)
        if let out = colorControls.outputImage {
            current = out
        }
    }
    if let unsharp = CIFilter(name: "CIUnsharpMask") {
        unsharp.setValue(current, forKey: kCIInputImageKey)
        unsharp.setValue(1.2, forKey: kCIInputRadiusKey)
        unsharp.setValue(0.45, forKey: kCIInputIntensityKey)
        if let out = unsharp.outputImage {
            current = out
        }
    }
    return ciContext.createCGImage(current, from: current.extent)
}

private func runImage(args: [String]) -> Int32 {
    guard args.count >= 2 else {
        fputs("Usage: rehearsal-omr-prep image <input.img> <out.png>\n", stderr)
        return 2
    }
    let inputURL = URL(fileURLWithPath: args[0])
    let outURL = URL(fileURLWithPath: args[1])

    guard let srcImage = CIImage(contentsOf: inputURL),
          let cgImage = enhanceCIImage(srcImage, deskew: true) else {
        fputs("Failed to process image: \(inputURL.path)\n", stderr)
        return 1
    }
    return writePNG(cgImage, to: outURL) ? 0 : 1
}

private func runText(args: [String]) -> Int32 {
    guard let path = args.first else {
        fputs("Usage: rehearsal-omr-prep text <input.pdf>\n", stderr)
        return 2
    }
    let url = URL(fileURLWithPath: path)
    guard let doc = PDFDocument(url: url) else {
        return 1
    }
    if let txt = doc.string, !txt.isEmpty {
        print(txt)
    }
    return 0
}

private func runRasterPDF(args: [String]) -> Int32 {
    guard args.count >= 2 else {
        fputs("Usage: rehearsal-omr-prep rasterpdf <input.pdf> <out.pdf> [dpi] [contrast]\n", stderr)
        return 2
    }
    let inputURL = URL(fileURLWithPath: args[0])
    let outURL = URL(fileURLWithPath: args[1])
    let dpi = args.count >= 3 ? (Double(args[2]) ?? 300.0) : 300.0
    let contrast = args.count >= 4 ? ((Int(args[3]) ?? 0) != 0) : false

    guard let doc = PDFDocument(url: inputURL), doc.pageCount > 0 else {
        fputs("Failed to open PDF: \(inputURL.path)\n", stderr)
        return 1
    }
    return writeRasterPDF(doc: doc, to: outURL, dpi: dpi, contrast: contrast) ? 0 : 1
}

private func runVariants(args: [String]) -> Int32 {
    guard args.count >= 2 else {
        fputs("Usage: rehearsal-omr-prep variants <input.pdf_or_img> <out_dir> [page_num]\n", stderr)
        return 2
    }
    let inputURL = URL(fileURLWithPath: args[0])
    let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
    let singlePage: Int? = args.count >= 3 ? Int(args[2]) : nil

    let v300Dir = outDir.appendingPathComponent("v300", isDirectory: true)
    let v400Dir = outDir.appendingPathComponent("v400", isDirectory: true)
    let v350cDir = outDir.appendingPathComponent("v350c", isDirectory: true)
    do {
        for d in [v300Dir, v400Dir, v350cDir] {
            try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
    } catch {
        fputs("Failed to create variant dirs: \(error)\n", stderr)
        return 1
    }

    if inputURL.pathExtension.lowercased() == "pdf", let doc = PDFDocument(url: inputURL) {
        let count = doc.pageCount
        guard count > 0 else { return 1 }
        let pageIndices: [Int]
        if let target = singlePage {
            guard target >= 1 && target <= count else { return 1 }
            pageIndices = [target - 1]
        } else {
            pageIndices = Array(0..<count)
        }

        for idx in pageIndices {
            guard let page = doc.page(at: idx) else { continue }
            let fname = String(format: "page-%04d.png", idx + 1)
            let u300 = v300Dir.appendingPathComponent(fname)
            let u400 = v400Dir.appendingPathComponent(fname)
            let u350c = v350cDir.appendingPathComponent(fname)
            if !renderPDFPage(page, dpi: 300.0, to: u300) { return 1 }
            if !renderPDFPage(page, dpi: 400.0, to: u400) { return 1 }
            if !renderPDFPage(page, dpi: 350.0, to: u350c) { return 1 }
            if let ci = CIImage(contentsOf: u350c), let enhanced = enhanceCIImage(ci, deskew: false) {
                _ = writePNG(enhanced, to: u350c)
            }
        }
        if singlePage == nil {
            if !writeRasterPDF(doc: doc, to: outDir.appendingPathComponent("v300.pdf"), dpi: 300.0, contrast: false) { return 1 }
            if !writeRasterPDF(doc: doc, to: outDir.appendingPathComponent("v400.pdf"), dpi: 400.0, contrast: false) { return 1 }
            if !writeRasterPDF(doc: doc, to: outDir.appendingPathComponent("v350c.pdf"), dpi: 350.0, contrast: true) { return 1 }
        }
        return 0
    }

    // Image input fallback: write grayscale/contrast variants
    guard let srcImage = CIImage(contentsOf: inputURL) else {
        fputs("Failed to load input for variants: \(inputURL.path)\n", stderr)
        return 1
    }
    let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    guard let rawCG = ciContext.createCGImage(srcImage, from: srcImage.extent),
          let enhCG = enhanceCIImage(srcImage, deskew: true) else {
        return 1
    }
    let fname = "page-0001.png"
    _ = writePNG(rawCG, to: v300Dir.appendingPathComponent(fname))
    _ = writePNG(rawCG, to: v400Dir.appendingPathComponent(fname))
    _ = writePNG(enhCG, to: v350cDir.appendingPathComponent(fname))
    return 0
}

let argv = Array(CommandLine.arguments.dropFirst())
guard let mode = argv.first else {
    fputs("Usage: rehearsal-omr-prep <pdf|image|rasterpdf|variants|text> ...\n", stderr)
    exit(2)
}

let rest = Array(argv.dropFirst())
switch mode {
case "pdf":
    exit(runPDF(args: rest))
case "image":
    exit(runImage(args: rest))
case "rasterpdf":
    exit(runRasterPDF(args: rest))
case "variants":
    exit(runVariants(args: rest))
case "text":
    exit(runText(args: rest))
default:
    fputs("Unknown mode: \(mode)\n", stderr)
    exit(2)
}
