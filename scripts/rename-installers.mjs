// Post-bundle cleanup: Tauri exposes no config for installer file names or for the
// MSI summary stream, so fix both here after `tauri build`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keys are MSI summary property ids: 2 = Title, 6 = Comments.
const MSI_SUMMARY = {
  2: "rbox Installer",
  6: "rbox - minimal region screen recorder",
};

/** Drops the language suffix: rbox_0.1.0_x64_en-US.msi -> rbox_0.1.0_x64.msi */
const shorten = (name) => name.replace(/_[a-z]{2}-[A-Z]{2}\.msi$/, ".msi");

if (process.argv[2] === "--check") {
  const { equal } = await import("node:assert/strict");
  equal(shorten("rbox_0.1.0_x64_en-US.msi"), "rbox_0.1.0_x64.msi");
  equal(shorten("rbox_0.1.0_x64.msi"), "rbox_0.1.0_x64.msi");
  console.log("ok");
  process.exit(0);
}

// Parameterised COM properties need InvokeMember, and the handles must be released
// or the .msi stays locked.
const PS = `
$ErrorActionPreference = 'Stop'
$call = { param($o, $name, $kind, $a) $o.GetType().InvokeMember($name, $kind, $null, $o, $a) }
$want = @(($env:MSI_SUMMARY | ConvertFrom-Json).PSObject.Properties)  # array, so .Count is the update slot count
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = & $call $installer 'OpenDatabase' 'InvokeMethod' @($env:MSI_PATH, 1)
$info = & $call $db 'SummaryInformation' 'GetProperty' @($want.Count)
foreach ($p in $want) { & $call $info 'Property' 'SetProperty' @([int]$p.Name, $p.Value) }
& $call $info 'Persist' 'InvokeMethod' $null
& $call $db 'Commit' 'InvokeMethod' $null
foreach ($o in $info, $db, $installer) { [Runtime.InteropServices.Marshal]::ReleaseComObject($o) | Out-Null }
[GC]::Collect()
$check = (New-Object -ComObject WindowsInstaller.Installer).SummaryInformation($env:MSI_PATH, 0)
foreach ($p in $want) {
  if ($check.Property([int]$p.Name) -ne $p.Value) { throw "summary property $($p.Name) not updated" }
}
`;

const patchMsi = (path) => {
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS], {
    env: { ...process.env, MSI_PATH: path, MSI_SUMMARY: JSON.stringify(MSI_SUMMARY) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  console.log(`patched summary stream: ${Object.values(MSI_SUMMARY).join(" / ")}`);
};

const dir = new URL("../src-tauri/target/release/bundle/msi/", import.meta.url);
if (existsSync(dir)) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".msi")) continue;
    const renamed = shorten(name);
    if (renamed !== name) {
      renameSync(new URL(name, dir), new URL(renamed, dir));
      console.log(`msi/${name} -> ${renamed}`);
    }
    patchMsi(fileURLToPath(new URL(renamed, dir)));
  }
}
