#!/usr/bin/env swift
// Renders a PDF to simulated phone-photo / photocopy raster pages
// (250 DPI, slight rotation, warm-gray paper background, mild Gaussian blur)
// and writes the resulting raster pages back into an output PDF.
//
// Usage: swift tools/omr-bench/degrade_pdf.swift <input.pdf> <output.pdf>

import Foundation
import PDFKit
import CoreImage
import CoreGraphics

let args = CommandLine.arguments
if args.count < 3 {
    fputs("Usage: degrade_pdf.swift <input.pdf> <output.pdf>\n", stderr)
    exit(2)
}

let inputUrl = URL(fileURLWithPath: args[1])
let outputUrl = URL(fileURLWithPath: args[2])

guard let doc = PDFDocument(url: inputUrl), doc.pageCount > 0 else {
    fputs("Failed to open PDF: \(args[1])\n", stderr)
    exit(1)
}

let firstBounds = doc.page(at: 0)!.bounds(for: .mediaBox)
var initialBox = CGRect(x: 0, y: 0, width: firstBounds.width, height: firstBounds.height)
guard let pdfCtx = CGContext(outputUrl as CFURL, mediaBox: &initialBox, nil) else {
    fputs("Failed to create PDF CGContext at \(args[2])\n", stderr)
    exit(1)
}

let dpi: CGFloat = 250.0
let scale = dpi / 72.0
let angleRad: CGFloat = 1.2 * .pi / 180.0
let ciContext = CIContext(options: [CIContextOption.useSoftwareRenderer: true])
var pagesWritten = 0

for idx in 0..<doc.pageCount {
    guard let page = doc.page(at: idx) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let width = max(1, Int((bounds.width * scale).rounded()))
    let height = max(1, Int((bounds.height * scale).rounded()))

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        fputs("Failed to create bitmap CGContext\n", stderr)
        continue
    }

    // Warm gray paper base (0.93)
    ctx.setFillColor(red: 0.93, green: 0.925, blue: 0.905, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))

    // Draw PDF page with slight tilt around center
    ctx.saveGState()
    ctx.translateBy(x: CGFloat(width) / 2.0, y: CGFloat(height) / 2.0)
    ctx.rotate(by: angleRad)
    ctx.translateBy(x: -CGFloat(width) / 2.0, y: -CGFloat(height) / 2.0)
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    guard let rawImg = ctx.makeImage() else {
        fputs("Failed ctx.makeImage()\n", stderr)
        continue
    }
    var ciImg = CIImage(cgImage: rawImg)
    let origExtent = ciImg.extent

    // Mild Gaussian blur (0.7) clamped to extent to avoid dark edge halo
    let clamped = ciImg.clampedToExtent()
    if let blur = CIFilter(name: "CIGaussianBlur") {
        blur.setValue(clamped, forKey: kCIInputImageKey)
        blur.setValue(0.7, forKey: kCIInputRadiusKey)
        if let out = blur.outputImage {
            ciImg = out.cropped(to: origExtent)
        }
    }

    // Slight photocopy contrast/gamma normalization
    if let controls = CIFilter(name: "CIColorControls") {
        controls.setValue(ciImg, forKey: kCIInputImageKey)
        controls.setValue(0.95, forKey: kCIInputContrastKey)
        controls.setValue(-0.02, forKey: kCIInputBrightnessKey)
        controls.setValue(0.0, forKey: kCIInputSaturationKey)
        if let out = controls.outputImage {
            ciImg = out.cropped(to: origExtent)
        }
    }

    guard let finalCG = ciContext.createCGImage(ciImg, from: origExtent) else {
        fputs("Failed ciContext.createCGImage() extent=\(origExtent)\n", stderr)
        continue
    }
    var pageRect = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height)
    pdfCtx.beginPage(mediaBox: &pageRect)
    pdfCtx.draw(finalCG, in: pageRect)
    pdfCtx.endPage()
    pagesWritten += 1
}

pdfCtx.closePDF()
if pagesWritten == 0 {
    fputs("No pages written to degraded PDF\n", stderr)
    exit(1)
}
print("Generated degraded PDF (\(pagesWritten)p): \(args[2])")
