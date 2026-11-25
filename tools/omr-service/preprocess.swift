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

private func renderPDFPage(_ page: PDFPage, dpi: Double, to url: URL) -> Bool {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0 && bounds.height > 0 else { return false }
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
        return false
    }

    ctx.interpolationQuality = .high
    ctx.setFillColor(gray: 1.0, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

    ctx.saveGState()
    ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    guard let cgImage = ctx.makeImage() else { return false }
    return writePNG(cgImage, to: url)
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

private func runImage(args: [String]) -> Int32 {
    guard args.count >= 2 else {
        fputs("Usage: rehearsal-omr-prep image <input.img> <out.png>\n", stderr)
        return 2
    }
    let inputURL = URL(fileURLWithPath: args[0])
    let outURL = URL(fileURLWithPath: args[1])

    guard let srcImage = CIImage(contentsOf: inputURL) else {
        fputs("Failed to load image: \(inputURL.path)\n", stderr)
        return 1
    }

    var current = srcImage
    if let colorControls = CIFilter(name: "CIColorControls") {
        colorControls.setValue(current, forKey: kCIInputImageKey)
        colorControls.setValue(0.0, forKey: kCIInputSaturationKey)
        colorControls.setValue(1.22, forKey: kCIInputContrastKey)
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

    let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    guard let cgImage = ciContext.createCGImage(current, from: current.extent) else {
        fputs("Failed to render processed image\n", stderr)
        return 1
    }
    return writePNG(cgImage, to: outURL) ? 0 : 1
}

let argv = Array(CommandLine.arguments.dropFirst())
guard let mode = argv.first else {
    fputs("Usage: rehearsal-omr-prep <pdf|image> ...\n", stderr)
    exit(2)
}

let rest = Array(argv.dropFirst())
switch mode {
case "pdf":
    exit(runPDF(args: rest))
case "image":
    exit(runImage(args: rest))
default:
    fputs("Unknown mode: \(mode)\n", stderr)
    exit(2)
}
