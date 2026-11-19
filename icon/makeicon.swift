// Renders Rehearsal's app icon. Several designs; pick one with the style argument.
//   swift icon/makeicon.swift <out.iconset> <style>        all sizes, for iconutil
//   swift icon/makeicon.swift --preview <out.png> <style>   one 512 px preview
// Styles: R (in use), rbaton, baton, stand, notes, check
import Cocoa

let args = CommandLine.arguments
let preview = args.count > 1 && args[1] == "--preview"
let out = preview ? args[2] : args[1]
let style = (preview ? (args.count > 3 ? args[3] : "R") : (args.count > 2 ? args[2] : "R"))

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor { NSColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a) }

// a notehead: a tilted ellipse centred at (x, y)
func head(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ color: NSColor, open: Bool = false) {
    let h = w * 0.72
    let t = NSAffineTransform(); t.translateX(by: x, yBy: y); t.rotate(byDegrees: 22)
    let p = NSBezierPath(ovalIn: NSRect(x: -w / 2, y: -h / 2, width: w, height: h)); p.transform(using: t as AffineTransform)
    color.set()
    if open { p.lineWidth = w * 0.16; p.stroke() } else { p.fill() }
}
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: NSColor, r: CGFloat = 0) {
    color.set(); NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: r, yRadius: r).fill()
}
func poly(_ pts: [NSPoint], _ color: NSColor) {
    let p = NSBezierPath(); p.move(to: pts[0]); pts.dropFirst().forEach { p.line(to: $0) }; p.close(); color.set(); p.fill()
}
func shadow(_ s: CGFloat, _ alpha: CGFloat = 0.28) {
    let sh = NSShadow(); sh.shadowColor = NSColor(white: 0, alpha: alpha); sh.shadowBlurRadius = s * 0.035; sh.shadowOffset = NSSize(width: 0, height: -s * 0.015); sh.set()
}

func draw(_ s: CGFloat) {
    let inset = s * 0.09, r = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let tile = NSBezierPath(roundedRect: r, xRadius: r.width * 0.225, yRadius: r.width * 0.225)
    let u = r.width, ox = r.minX, oy = r.minY                    // drawing units inside the tile
    let P = { (x: CGFloat, y: CGFloat) in NSPoint(x: ox + x * u, y: oy + y * u) }
    let white = NSColor.white
    NSGraphicsContext.saveGraphicsState()
    shadow(s, 0.25)
    switch style {
    case "R":           // a bold capital R, light pastel blue on dark pastel blue
        NSGradient(starting: rgb(120, 154, 212), ending: rgb(66, 98, 160))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState()
        // the letter as an outline from the system font (bold), centred on its own shape
        let font = CTFontCreateWithFontDescriptor(NSFont.systemFont(ofSize: u * 0.66, weight: .bold).fontDescriptor as CTFontDescriptor, u * 0.66, nil)
        var ch: [UniChar] = Array("R".utf16), g = [CGGlyph](repeating: 0, count: 1)
        CTFontGetGlyphsForCharacters(font, &ch, &g, 1)
        if let cg = CTFontCreatePathForGlyph(font, g[0], nil) {
            let b = cg.boundingBoxOfPath
            var t = CGAffineTransform(translationX: ox + (u - b.width) / 2 - b.minX, y: oy + (u - b.height) / 2 - b.minY)
            if let placed = cg.copy(using: &t), let ctx = NSGraphicsContext.current?.cgContext {
                shadow(s, 0.22)
                ctx.addPath(placed); ctx.setFillColor(rgb(214, 234, 252).cgColor); ctx.fillPath()
            }
        }
    case "baton":       // a conductor's beat pattern and baton on deep indigo
        NSGradient(starting: rgb(72, 52, 212), ending: rgb(24, 20, 74))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState(); tile.addClip()
        let path = NSBezierPath()                                  // a 4-beat pattern: down, in, out, up
        path.move(to: P(0.50, 0.80)); path.curve(to: P(0.46, 0.26), controlPoint1: P(0.50, 0.55), controlPoint2: P(0.44, 0.34))
        path.curve(to: P(0.24, 0.50), controlPoint1: P(0.36, 0.30), controlPoint2: P(0.22, 0.38))
        path.curve(to: P(0.78, 0.44), controlPoint1: P(0.40, 0.48), controlPoint2: P(0.64, 0.36))
        path.curve(to: P(0.52, 0.78), controlPoint1: P(0.84, 0.56), controlPoint2: P(0.62, 0.70))
        path.lineWidth = u * 0.055; path.lineCapStyle = .round; path.lineJoinStyle = .round
        rgb(255, 199, 95).setStroke(); path.stroke()
        for (x, y) in [(0.46, 0.26), (0.24, 0.50), (0.78, 0.44), (0.50, 0.80)] {   // the beats
            white.setFill(); NSBezierPath(ovalIn: NSRect(x: ox + CGFloat(x) * u - u * 0.045, y: oy + CGFloat(y) * u - u * 0.045, width: u * 0.09, height: u * 0.09)).fill()
        }
        let baton = NSBezierPath(); baton.move(to: P(0.60, 0.62)); baton.line(to: P(0.86, 0.88))
        baton.lineWidth = u * 0.025; baton.lineCapStyle = .round; white.setStroke(); baton.stroke()
        rgb(186, 126, 74).setFill(); NSBezierPath(ovalIn: NSRect(x: ox + 0.555 * u, y: oy + 0.575 * u, width: u * 0.075, height: u * 0.075)).fill()
    case "rbaton":      // a script capital R traced like a conducting pattern by an upright baton
        NSGradient(starting: rgb(76, 58, 220), ending: rgb(22, 18, 70))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState(); tile.addClip()
        let gold = rgb(255, 204, 110)
        // script capital R in one conducted stroke: down the stem, back up into the bowl, round it,
        // a small loop at the waist, then the leg sweeps out to where the baton's tip is now
        let r = NSBezierPath()
        r.move(to: P(0.40, 0.745))
        r.curve(to: P(0.335, 0.255), controlPoint1: P(0.385, 0.56), controlPoint2: P(0.365, 0.36))        // stem
        r.curve(to: P(0.245, 0.30), controlPoint1: P(0.31, 0.215), controlPoint2: P(0.255, 0.235))        // foot curls left
        r.curve(to: P(0.47, 0.765), controlPoint1: P(0.235, 0.42), controlPoint2: P(0.33, 0.75))          // swash back up to the top
        r.curve(to: P(0.66, 0.635), controlPoint1: P(0.59, 0.78), controlPoint2: P(0.67, 0.71))           // over the bowl
        r.curve(to: P(0.43, 0.505), controlPoint1: P(0.65, 0.55), controlPoint2: P(0.53, 0.50))           // back to the waist
        r.curve(to: P(0.465, 0.53), controlPoint1: P(0.405, 0.51), controlPoint2: P(0.43, 0.545))         // little loop
        r.curve(to: P(0.585, 0.275), controlPoint1: P(0.53, 0.47), controlPoint2: P(0.545, 0.33))         // the leg
        r.curve(to: P(0.685, 0.345), controlPoint1: P(0.615, 0.235), controlPoint2: P(0.66, 0.29))        // a short exit flick
        let lift = NSAffineTransform(); lift.translateX(by: -0.04 * u, yBy: 0.10 * u); r.transform(using: lift as AffineTransform)   // room for the baton below
        r.lineWidth = u * 0.016; r.lineCapStyle = .round; r.lineJoinStyle = .round       // as thin as the baton
        let glow = NSShadow(); glow.shadowColor = gold.withAlphaComponent(0.6); glow.shadowBlurRadius = u * 0.03; glow.set()
        gold.setStroke(); r.stroke()
        NSShadow().set()
        // the baton, drawn along its own axis from the tip (at the end of the stroke) to the handle
        let tip = P(0.645, 0.445), end = P(0.79, 0.085)            // held upright: tip at the end of the stroke, handle down
        let dx = end.x - tip.x, dy = end.y - tip.y, len = hypot(dx, dy)
        NSGraphicsContext.saveGraphicsState()
        let t = NSAffineTransform(); t.translateX(by: tip.x, yBy: tip.y); t.rotate(byRadians: atan2(dy, dx)); t.concat()
        shadow(s, 0.4)
        let L = len, hw = u * 0.03                                  // handle half-width
        let shaftEnd = L * 0.70, ferrule = L * 0.055
        // shaft: a long taper, white with a soft edge
        let shaft = NSBezierPath()
        shaft.move(to: NSPoint(x: 0, y: -u * 0.0035)); shaft.line(to: NSPoint(x: shaftEnd, y: -u * 0.0085))
        shaft.line(to: NSPoint(x: shaftEnd, y: u * 0.0085)); shaft.line(to: NSPoint(x: 0, y: u * 0.0035))
        shaft.appendArc(withCenter: NSPoint(x: 0, y: 0), radius: u * 0.0035, startAngle: 90, endAngle: 270); shaft.close()
        NSGradient(colors: [rgb(255, 255, 255), rgb(222, 224, 236)])!.draw(in: shaft, angle: 90)
        NSShadow().set()
        // ferrule: a small metal band where the shaft meets the handle
        let fr = NSBezierPath(roundedRect: NSRect(x: shaftEnd - u * 0.002, y: -u * 0.012, width: ferrule, height: u * 0.024), xRadius: u * 0.004, yRadius: u * 0.004)
        NSGradient(colors: [rgb(250, 250, 255), rgb(170, 176, 196), rgb(120, 126, 150)])!.draw(in: fr, angle: 90)
        // handle: a pear-shaped cork grip, widest near the end
        let h0 = shaftEnd + ferrule - u * 0.003, h1 = L
        let grip = NSBezierPath()
        grip.move(to: NSPoint(x: h0, y: -u * 0.013))
        grip.curve(to: NSPoint(x: h1 - hw, y: -hw), controlPoint1: NSPoint(x: h0 + (h1 - h0) * 0.35, y: -u * 0.014), controlPoint2: NSPoint(x: h1 - hw * 2.2, y: -hw))
        grip.appendArc(withCenter: NSPoint(x: h1 - hw, y: 0), radius: hw, startAngle: 270, endAngle: 90)
        grip.curve(to: NSPoint(x: h0, y: u * 0.013), controlPoint1: NSPoint(x: h1 - hw * 2.2, y: hw), controlPoint2: NSPoint(x: h0 + (h1 - h0) * 0.35, y: u * 0.014))
        grip.close()
        NSGradient(colors: [rgb(236, 190, 132), rgb(196, 134, 80), rgb(140, 88, 48)])!.draw(in: grip, angle: 90)
        // cork grain and a highlight along the top
        NSGraphicsContext.saveGraphicsState(); grip.addClip()
        rgb(120, 74, 38, 0.35).setFill()
        for i in 0..<9 { let gx = h0 + (h1 - h0) * (0.12 + CGFloat(i) * 0.095); NSBezierPath(ovalIn: NSRect(x: gx, y: (i % 2 == 0 ? -0.006 : 0.002) * u, width: u * 0.006, height: u * 0.004)).fill() }
        let hl = NSBezierPath(); hl.move(to: NSPoint(x: h0 + u * 0.01, y: u * 0.008)); hl.curve(to: NSPoint(x: h1 - hw * 0.8, y: hw * 0.62), controlPoint1: NSPoint(x: h0 + (h1 - h0) * 0.4, y: u * 0.01), controlPoint2: NSPoint(x: h1 - hw * 2, y: hw * 0.75))
        hl.lineWidth = u * 0.005; hl.lineCapStyle = .round; NSColor(white: 1, alpha: 0.45).setStroke(); hl.stroke()
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.restoreGraphicsState()
    case "stand":       // sheet music on a music stand, warm coral
        NSGradient(starting: rgb(255, 138, 101), ending: rgb(214, 64, 80))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState(); shadow(s)
        let navy = rgb(32, 36, 64)
        rect(0.475 * u + ox, 0.10 * u + oy, 0.05 * u, 0.36 * u, navy, r: u * 0.02)               // pole
        poly([P(0.30, 0.10), P(0.70, 0.10), P(0.53, 0.17), P(0.47, 0.17)], navy)                // feet
        rect(0.16 * u + ox, 0.36 * u + oy, 0.68 * u, 0.06 * u, navy, r: u * 0.02)               // ledge
        rect(0.20 * u + ox, 0.40 * u + oy, 0.60 * u, 0.46 * u, rgb(255, 251, 240), r: u * 0.03) // the page
        NSShadow().set()
        for i in 0..<5 { rect(0.26 * u + ox, (0.52 + CGFloat(i) * 0.05) * u + oy, 0.48 * u, max(1, 0.008 * u), rgb(150, 150, 165)) }
        for (x, y) in [(0.36, 0.545), (0.50, 0.62), (0.64, 0.695)] {
            head(ox + CGFloat(x) * u, oy + CGFloat(y) * u, 0.075 * u, navy)
            rect(ox + (CGFloat(x) + 0.031) * u, oy + CGFloat(y) * u, 0.012 * u, 0.15 * u, navy)
        }
    case "check":       // a note and a green check: practice that gets graded
        NSGradient(starting: rgb(28, 49, 92), ending: rgb(10, 22, 44))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState()
        for i in 0..<5 { rect(ox + 0.08 * u, oy + (0.30 + CGFloat(i) * 0.09) * u, 0.84 * u, max(1, 0.012 * u), NSColor(white: 1, alpha: 0.22)) }
        shadow(s)
        head(ox + 0.38 * u, oy + 0.39 * u, 0.20 * u, white)
        rect(ox + 0.464 * u, oy + 0.40 * u, 0.035 * u, 0.40 * u, white, r: u * 0.01)
        let flag = NSBezierPath(); flag.move(to: P(0.50, 0.80)); flag.curve(to: P(0.62, 0.52), controlPoint1: P(0.52, 0.70), controlPoint2: P(0.68, 0.66))
        flag.curve(to: P(0.50, 0.66), controlPoint1: P(0.60, 0.60), controlPoint2: P(0.54, 0.66)); flag.close(); white.setFill(); flag.fill()
        let c = NSRect(x: ox + 0.56 * u, y: oy + 0.10 * u, width: 0.32 * u, height: 0.32 * u)
        rgb(46, 196, 120).setFill(); NSBezierPath(ovalIn: c).fill()
        NSShadow().set()
        let ck = NSBezierPath(); ck.move(to: P(0.635, 0.265)); ck.line(to: P(0.70, 0.195)); ck.line(to: P(0.81, 0.33))
        ck.lineWidth = u * 0.045; ck.lineCapStyle = .round; ck.lineJoinStyle = .round; white.setStroke(); ck.stroke()
    default:            // "notes": two beamed eighth notes on teal
        NSGradient(starting: rgb(32, 201, 166), ending: rgb(14, 110, 130))!.draw(in: tile, angle: -70)
        NSGraphicsContext.restoreGraphicsState(); NSGraphicsContext.saveGraphicsState(); shadow(s)
        head(ox + 0.30 * u, oy + 0.28 * u, 0.22 * u, white)
        head(ox + 0.66 * u, oy + 0.36 * u, 0.22 * u, white)
        rect(ox + 0.386 * u, oy + 0.29 * u, 0.045 * u, 0.48 * u, white)
        rect(ox + 0.746 * u, oy + 0.37 * u, 0.045 * u, 0.48 * u, white)
        poly([P(0.386, 0.72), P(0.791, 0.80), P(0.791, 0.88), P(0.386, 0.80)], white)
    }
    NSGraphicsContext.restoreGraphicsState()
}

func render(_ px: Int) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(CGFloat(px))
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

if preview {
    try! render(512).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
} else {
    try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
    for (size, scale) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
        let name = scale == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
        try! render(size * scale).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
    }
}
