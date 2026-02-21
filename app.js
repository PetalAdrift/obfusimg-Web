const fileInput = document.getElementById('fileInput');
const algorithmSelect = document.getElementById('algorithmSelect');
const seedInput = document.getElementById('seedInput');
const runBtn = document.getElementById('runBtn');
const swapBtn = document.getElementById('swapBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const inputCanvas = document.getElementById('inputCanvas');
const outputCanvas = document.getElementById('outputCanvas');
const ictx = inputCanvas.getContext('2d', { willReadFrequently: true });
const octx = outputCanvas.getContext('2d', { willReadFrequently: true });

console.log('original C++ by __roselle__ and pigeon.hannah; ported by LLM');

// --- remember original file info ---
let loadedFileMime = 'image/png';
let loadedFileName = 'obfusimg_out.png';

function setStatus(msg) { statusEl.textContent = msg; }

function syncCanvasSize(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    // --- save original mime/name ---
    loadedFileMime = file.type || 'image/png';
    loadedFileName = file.name || 'obfusimg_out.png';

    const bmp = await createImageBitmap(file);
    syncCanvasSize(inputCanvas, bmp.width, bmp.height);
    syncCanvasSize(outputCanvas, bmp.width, bmp.height);
    ictx.clearRect(0, 0, bmp.width, bmp.height);
    octx.clearRect(0, 0, bmp.width, bmp.height);
    ictx.drawImage(bmp, 0, 0);
    setStatus(`Loaded ${file.name} (${bmp.width}×${bmp.height}).`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load image.');
  }
});

runBtn.addEventListener('click', () => {
  if (inputCanvas.width === 0 || inputCanvas.height === 0) {
    setStatus('Please load an image first.');
    return;
  }
  try {
    const alg = Number(algorithmSelect.value);
    const seed = Number(seedInput.value);
    const w = inputCanvas.width;
    const h = inputCanvas.height;

    const src = ictx.getImageData(0, 0, w, h);
    const out = runObfuscation(src, w, h, alg, seed);
    octx.putImageData(out, 0, 0);
    setStatus(`Done. Algorithm ${alg} applied on ${w*h} pixels.`);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
});

swapBtn.addEventListener('click', () => {
  if (outputCanvas.width === 0 || outputCanvas.height === 0) return;
  const img = octx.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
  syncCanvasSize(inputCanvas, outputCanvas.width, outputCanvas.height);
  ictx.putImageData(img, 0, 0);
  setStatus('Output copied to input.');
});

downloadBtn.addEventListener('click', () => {
  if (outputCanvas.width === 0 || outputCanvas.height === 0) {
    setStatus('No output image to download.');
    return;
  }

  // --- preserve png/jpg when possible ---
  let outMime = loadedFileMime;
  if (!['image/png', 'image/jpeg'].includes(outMime)) {
    outMime = 'image/png';
  }

  // If original was JPG but output has transparency, force PNG
  if (outMime === 'image/jpeg') {
    const img = octx.getImageData(0, 0, outputCanvas.width, outputCanvas.height).data;
    for (let i = 3; i < img.length; i += 4) {
      if (img[i] !== 255) {
        outMime = 'image/png';
        break;
      }
    }
  }

  const baseName = loadedFileName.replace(/\.[^.]+$/, '') || 'obfusimg_out';
  const ext = outMime === 'image/jpeg' ? 'jpg' : 'png';
  const quality = outMime === 'image/jpeg' ? 0.92 : undefined;

  outputCanvas.toBlob((blob) => {
    if (!blob) {
      setStatus('Failed to encode image.');
      return;
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `${baseName}_out.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${baseName}_out.${ext}`);
  }, outMime, quality);
});

function runObfuscation(imageData, width, height, alg, seed) {
  let perm;
  switch (alg) {
    case 0: {
      // Compact Hilbert/Gilbert (original)
      let g = generateGFunction(width, height);
      g = normalizePermutation(g);
      perm = invertPermutation(g);
      break;
    }
    case 1: {
      // Inverse compact Hilbert/Gilbert
      let g = generateGFunction(width, height);
      g = normalizePermutation(g);
      perm = g;
      break;
    }
    case 2: {
      // Exact Gilbert path shift (Fanqie-compatible encrypt)
      perm = generateExactGilbertShiftPermutation(width, height, false);
      break;
    }
    case 3: {
      // Inverse exact Gilbert path shift (Fanqie-compatible decrypt)
      perm = generateExactGilbertShiftPermutation(width, height, true);
      break;
    }
    case 4: {
      // Chaotic tent-map permutation
      perm = generateChaoticPermutation(width * height, seed, x => tentMap(x, 1.9999));
      break;
    }
    case 5: {
      // Inverse chaotic tent-map permutation
      const p = generateChaoticPermutation(width * height, seed, x => tentMap(x, 1.9999));
      perm = invertPermutation(p);
      break;
    }
    default:
      throw new Error('Unknown algorithm');
  }
  return applyPermutation(imageData, perm, width, height);
}

// ===== Ported core algorithms from C++ =====

function normalizePermutation(perm) {
  const indexed = perm.map((v, i) => ({ v, i }));
  // Stable sort: modern JS engines are stable. Tie-break by original index for safety.
  indexed.sort((a, b) => (a.v - b.v) || (a.i - b.i));
  const normalized = new Array(perm.length);
  for (let rank = 0; rank < indexed.length; rank++) {
    normalized[indexed[rank].i] = rank;
  }
  return normalized;
}

function invertPermutation(perm) {
  const inv = new Array(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

function applyPermutation(imageData, perm, width, height) {
  const channels = 4; // Canvas ImageData is RGBA
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const srcPix = perm[i];
    const di = i * channels;
    const si = srcPix * channels;
    dst[di] = src[si];
    dst[di + 1] = src[si + 1];
    dst[di + 2] = src[si + 2];
    dst[di + 3] = src[si + 3];
  }
  return new ImageData(dst, width, height);
}

function tentMap(x, mu) {
  return x < 0.5 ? mu * x : mu * (1.0 - x);
}

function generateChaoticPermutation(n, seed, mapFn) {
  const chaotic = new Array(n);
  let x = seed - Math.floor(seed);
  for (let i = 0; i < n; i++) {
    x = mapFn(x);
    chaotic[i] = { x, i };
  }
  chaotic.sort((a, b) => (a.x - b.x) || (a.i - b.i));
  const perm = new Array(n);
  for (let i = 0; i < n; i++) perm[i] = chaotic[i].i;
  return perm;
}

function getBit(val, bit) {
  return (val >> bit) & 1;
}

function getCompactIndex(x, y, wPrec, hPrec) {
  const maxPrec = Math.max(wPrec, hPrec);
  let hC = 0;
  let e = 0, d = 0;

  for (let i = maxPrec - 1; i >= 0; --i) {
    const xActive = (wPrec > i);
    const yActive = (hPrec > i);

    const bx = xActive ? getBit(x, i) : 0;
    const by = yActive ? getBit(y, i) : 0;

    const l = (bx << 1) | by;
    const lSwapped = d ? ((l >> 1) | ((l & 1) << 1)) : l;
    const t = lSwapped ^ e;

    const bitsToAdd = (xActive ? 1 : 0) + (yActive ? 1 : 0);
    let r = 0;

    if (xActive && yActive) {
      r = (t === 0) ? 0 : (t === 1) ? 1 : (t === 3) ? 2 : 3;
      if (r === 0) {
        d ^= 1;
      } else if (r === 3) {
        d ^= 1;
        e ^= 3;
      }
    } else {
      if (xActive) {
        r = (t >> (d ? 0 : 1)) & 1;
      } else {
        r = (t >> (d ? 1 : 0)) & 1;
      }
    }

    hC = (hC << bitsToAdd) | r;
  }

  return hC;
}

function ceilLog2Positive(n) {
  if (n <= 1) return 0;
  return Math.ceil(Math.log2(n));
}

function generateGFunction(w, h) {
  const wPrec = ceilLog2Positive(w);
  const hPrec = ceilLog2Positive(h);
  const gc = new Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      gc[r * w + c] = getCompactIndex(c, r, wPrec, hPrec);
    }
  }
  return gc;
}

// ===== Exact Gilbert path generator (Fanqie-compatible) =====

function gilbert2d(width, height) {
  const coordinates = [];
  if (width >= height) {
    generate2d(0, 0, width, 0, 0, height, coordinates);
  } else {
    generate2d(0, 0, 0, height, width, 0, coordinates);
  }
  return coordinates;
}

function generate2d(x, y, ax, ay, bx, by, coordinates) {
  const w = Math.abs(ax + ay);
  const h = Math.abs(bx + by);

  const dax = Math.sign(ax), day = Math.sign(ay); // unit major direction
  const dbx = Math.sign(bx), dby = Math.sign(by); // unit orthogonal direction

  if (h === 1) {
    // trivial row fill
    for (let i = 0; i < w; i++) {
      coordinates.push([x, y]);
      x += dax;
      y += day;
    }
    return;
  }

  if (w === 1) {
    // trivial column fill
    for (let i = 0; i < h; i++) {
      coordinates.push([x, y]);
      x += dbx;
      y += dby;
    }
    return;
  }

  let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
  let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);

  const w2 = Math.abs(ax2 + ay2);
  const h2 = Math.abs(bx2 + by2);

  if (2 * w > 3 * h) {
    if ((w2 % 2) && (w > 2)) {
      // prefer even steps
      ax2 += dax;
      ay2 += day;
    }

    // long case: split in two parts only
    generate2d(x, y, ax2, ay2, bx, by, coordinates);
    generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, coordinates);

  } else {
    if ((h2 % 2) && (h > 2)) {
      // prefer even steps
      bx2 += dbx;
      by2 += dby;
    }

    // standard case: one step up, one long horizontal, one step down
    generate2d(x, y, bx2, by2, ax2, ay2, coordinates);
    generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, coordinates);
    generate2d(
      x + (ax - dax) + (bx2 - dbx),
      y + (ay - day) + (by2 - dby),
      -bx2, -by2, -(ax - ax2), -(ay - ay2),
      coordinates
    );
  }
}

/**
 * Builds permutation in applyPermutation format:
 *   perm[dstRaster] = srcRaster
 *
 * decryptMode = false -> Fanqie encrypt-compatible (forward shift)
 * decryptMode = true  -> Fanqie decrypt-compatible (inverse)
 */
function generateExactGilbertShiftPermutation(width, height, decryptMode) {
  const curve = gilbert2d(width, height);
  const n = width * height;
  const offset = Math.round(((Math.sqrt(5) - 1) / 2) * n);

  const perm = new Array(n);

  for (let i = 0; i < n; i++) {
    const [sx, sy] = curve[i];
    const [dx, dy] = curve[(i + offset) % n];

    const srcRaster = sy * width + sx;
    const dstRaster = dy * width + dx;

    if (!decryptMode) {
      // encrypt: dst gets src
      perm[dstRaster] = srcRaster;
    } else {
      // decrypt: inverse mapping
      perm[srcRaster] = dstRaster;
    }
  }

  return perm;
}