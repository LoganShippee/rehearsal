// Release signing for Rehearsal updates (Ed25519, Apple CryptoKit).
//   rehearsal-sign keygen <private-key-file>        makes a key; prints the public key (base64)
//   rehearsal-sign sign <private-key-file> <file>   prints the signature of <file> (base64)
//   rehearsal-sign verify <public-key> <file> <sig> exits 0 if the signature is good
import Foundation
import CryptoKit

let a = CommandLine.arguments
func die(_ s: String) -> Never { FileHandle.standardError.write(Data((s + "\n").utf8)); exit(1) }
func readKey(_ path: String) -> Curve25519.Signing.PrivateKey {
    guard let s = try? String(contentsOfFile: path, encoding: .utf8),
          let d = Data(base64Encoded: s.trimmingCharacters(in: .whitespacesAndNewlines)),
          let k = try? Curve25519.Signing.PrivateKey(rawRepresentation: d) else { die("Can't read the release key at \(path)") }
    return k
}
guard a.count >= 3 else { die("usage: rehearsal-sign keygen <keyfile> | sign <keyfile> <file> | verify <pub> <file> <sig>") }
switch a[1] {
case "keygen":
    if FileManager.default.fileExists(atPath: a[2]) { die("\(a[2]) already exists — not overwriting your release key.") }
    let k = Curve25519.Signing.PrivateKey()
    let url = URL(fileURLWithPath: a[2])
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: a[2], contents: Data(k.rawRepresentation.base64EncodedString().utf8), attributes: [.posixPermissions: 0o600])
    print(k.publicKey.rawRepresentation.base64EncodedString())
case "sign":
    guard a.count >= 4, let d = FileManager.default.contents(atPath: a[3]) else { die("can't read \(a.count >= 4 ? a[3] : "file")") }
    print(try! readKey(a[2]).signature(for: d).base64EncodedString())
case "verify":
    guard a.count >= 5, let pk = Data(base64Encoded: a[2]), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pk),
          let d = FileManager.default.contents(atPath: a[3]), let sigT = try? String(contentsOfFile: a[4], encoding: .utf8),
          let sig = Data(base64Encoded: sigT.trimmingCharacters(in: .whitespacesAndNewlines)) else { die("bad arguments") }
    exit(key.isValidSignature(sig, for: d) ? 0 : 2)
default: die("unknown command \(a[1])")
}
