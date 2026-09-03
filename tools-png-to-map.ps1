# gym.png -> GYM_MAP. There is no node on this machine, so System.Drawing does
# the reading; the image is 40x25 with four flat colours and no anti-aliasing,
# so every pixel maps to exactly one glyph and nothing has to be guessed at.
Add-Type -AssemblyName System.Drawing

$src = "c:\Users\aydin\OneDrive\Claude VS Code\Platformer\gym.png.png"
$img = New-Object System.Drawing.Bitmap($src)

$GLYPH = @{
  "0,0,0"       = "#"  # solid
  "0,255,0"     = "."  # air
  "255,0,0"     = "L"  # lava
  "255,255,0"   = "D"  # the door
}

$rows = @()
$door = @{ x0 = 999; y0 = 999; x1 = -1; y1 = -1 }

for ($y = 0; $y -lt $img.Height; $y++) {
  $line = ""
  for ($x = 0; $x -lt $img.Width; $x++) {
    $c = $img.GetPixel($x, $y)
    $key = "{0},{1},{2}" -f $c.R, $c.G, $c.B
    if (-not $GLYPH.ContainsKey($key)) {
      throw "unmapped colour $key at $x,$y"
    }
    $g = $GLYPH[$key]
    if ($g -eq "D") {
      if ($x -lt $door.x0) { $door.x0 = $x }
      if ($y -lt $door.y0) { $door.y0 = $y }
      if ($x -gt $door.x1) { $door.x1 = $x }
      if ($y -gt $door.y1) { $door.y1 = $y }
    }
    $line += $g
  }
  $rows += $line
}
$img.Dispose()

"    " + (-join (0..($rows[0].Length - 1) | ForEach-Object { $_ % 10 }))
for ($i = 0; $i -lt $rows.Count; $i++) { "{0,2}  {1}" -f $i, $rows[$i] }
""
"door: x {0} y {1} w {2} h {3}" -f $door.x0, $door.y0, ($door.x1 - $door.x0 + 1), ($door.y1 - $door.y0 + 1)
""
"--- GYM_MAP ---"
for ($i = 0; $i -lt $rows.Count; $i++) {
  $comma = if ($i -lt $rows.Count - 1) { "," } else { "," }
  '    "{0}"{1}' -f $rows[$i], $comma
}
