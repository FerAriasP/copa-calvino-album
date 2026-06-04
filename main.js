const SUPABASE_URL = 'https://iqlpmckvcxbrxeehdner.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_UPG1CtRN3FutCcPlIw4lJg_NmT8Mzn5';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let album = null;
let savedStickers = {};
let currentPage = 0;
let selectedSpot = null;

const params = new URLSearchParams(window.location.search);
const isAdmin = params.get('admin') === '1';
const albumCode = getAlbumCodeFromUrl();

const pages = [
  { title: 'Front Page', layout: 'front.jpg', spots: [] },
  { title: 'Bienvenida', layout: 'bienvenida.jpg', spots: [] },
  { title: 'Historia de la Copa Calvino', layout: 'historia.jpg', spots: [] },
  {
    title: 'Submarino Amarillo',
    layout: 'submarino.jpg',
    spots: [
      ...spotsFromCoords([1,2,3,4], [52.2,64.3,76.4,88.4], 13.5, 8.8, 19.5),
      ...spotsFromCoords([5,6,7,8], [52.2,64.3,76.4,88.4], 55.5, 8.8, 19.5)
    ]
  },
  {
    title: 'Hammers',
    layout: 'hammers.jpg',
    spots: [
      ...spotsFromCoords([9,10,11,12], [47.0,59.2,71.5,83.7], 15.0, 9.0, 18.5),
      ...spotsFromCoords([13,14,15,16], [47.0,59.2,71.5,83.7], 56.0, 9.0, 18.5)
    ]
  },
  {
    title: 'Equipo Blanco',
    layout: 'blanco.jpg',
    spots: [
      ...spotsFromCoords([17,18,19,20], [51.0,63.0,75.5,87.3], 13.0, 8.8, 14.5),
      ...spotsFromCoords([21,22,23,24], [51.0,63.0,75.5,87.3], 51.5, 8.8, 14.5)
    ]
  },
  {
    title: 'Equipo Rojo',
    layout: 'rojo.jpg',
    spots: [
      ...spotsFromCoords([25,26,27,28], [48.3,60.8,73.0,85.2], 13.5, 8.2, 15.5),
      ...spotsFromCoords([29,30,31,32], [48.3,60.8,73.0,85.2], 52.5, 8.2, 15.5)
    ]
  },
  {
    title: 'San Jose A',
    layout: 'sanjose.jpg',
    spots: [
      ...spotsFromCoords([33,34,35,36], [52.4,63.6,75.0,86.4], 16.0, 8.5, 18.0),
      ...spotsFromCoords([37,38,39,40], [52.4,63.6,75.0,86.4], 58.0, 8.5, 18.0)
    ]
  },
  {
    title: 'Equipo Verde',
    layout: 'verde.jpg',
    spots: [
      ...spotsFromCoords([41,42,43,44], [48.3,60.8,73.0,85.2], 13.5, 8.2, 15.5),
      ...spotsFromCoords([45,46,47,48], [48.3,60.8,73.0,85.2], 52.5, 8.2, 15.5)
    ]
  },
  {
    title: 'Leyendas',
    layout: 'leyendas.jpg',
    spots: [
      { number: 49, left: 18, top: 25, width: 14, height: 35 },
      { number: 50, left: 34, top: 25, width: 14, height: 35 },
      { number: 51, left: 50, top: 25, width: 14, height: 35 },
      { number: 52, left: 66, top: 25, width: 14, height: 35 },
      { number: 53, left: 34, top: 62, width: 14, height: 30 },
      { number: 54, left: 50, top: 62, width: 14, height: 30 }
    ]
  },
  { title: 'Back Page', layout: 'back.jpg', spots: [] }
];

function getAlbumCodeFromUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'album' && parts[1]) return parts[1];
  return params.get('album') || params.get('user') || '';
}

function spotsFromCoords(numbers, lefts, top, width, height) {
  return numbers.map(function(number, index) {
    return { number, left: lefts[index], top, width, height };
  });
}

function layoutUrl(filename) {
  return `${SUPABASE_URL}/storage/v1/object/public/album-layouts/${encodeURIComponent(filename)}`;
}

function uploadUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/album-uploads/${encodePath(path)}`;
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function setStatus(message) {
  document.getElementById('status').textContent = message;
}

async function loadAlbum() {
  if (!albumCode && !isAdmin) {
    document.getElementById('book').innerHTML = '<div class="error-box">Album link missing.</div>';
    setStatus('Missing album code');
    return;
  }

  if (isAdmin && !albumCode) {
    album = { id: null, code: 'admin-test', first_name: 'Prueba', last_name: 'Watermark' };
    renderPage();
    setStatus('Admin/test view');
    return;
  }

  const { data, error } = await supabaseClient
    .from('albums')
    .select('*')
    .eq('code', albumCode)
    .single();

  if (error || !data) {
    document.getElementById('book').innerHTML = '<div class="error-box">Album not found.</div>';
    setStatus('Album not found');
    return;
  }

  album = data;
  await loadStickers();
  renderPage();
  setStatus('Album loaded');
}

async function loadStickers() {
  if (!album || !album.id) return;

  const { data, error } = await supabaseClient
    .from('album_stickers')
    .select('*')
    .eq('album_id', album.id);

  if (error) {
    setStatus('Error loading stickers');
    return;
  }

  savedStickers = {};
  (data || []).forEach(function(row) {
    savedStickers[row.spot_number] = {
      storagePath: row.storage_path,
      url: uploadUrl(row.storage_path)
    };
  });
}

function renderPage(direction) {
  const page = pages[currentPage];
  const book = document.getElementById('book');
  const buyerName = album ? `${album.first_name || ''} ${album.last_name || ''}`.trim() : '';

  book.classList.remove('turn-next', 'turn-prev');

  book.innerHTML = `
    <div class="image-wrap" id="imageWrap">
      <img class="layout-image" src="${layoutUrl(page.layout)}">
      ${buyerName && !isAdmin ? `<div class="watermark">${escapeHtml(buyerName)}</div>` : ''}
    </div>
  `;

  if (direction) {
    requestAnimationFrame(function() {
      book.classList.add(direction === 'prev' ? 'turn-prev' : 'turn-next');
      setTimeout(function() {
        book.classList.remove('turn-next', 'turn-prev');
      }, 360);
    });
  }

  const imageWrap = document.getElementById('imageWrap');

  page.spots.forEach(function(spot) {
    const spotDiv = document.createElement('div');
    spotDiv.className = 'sticker-spot';
    spotDiv.style.left = spot.left + '%';
    spotDiv.style.top = spot.top + '%';
    spotDiv.style.width = spot.width + '%';
    spotDiv.style.height = spot.height + '%';

    spotDiv.onclick = function() { chooseSticker(spot.number); };

    if (savedStickers[spot.number]) {
      spotDiv.innerHTML = `
        <img src="${savedStickers[spot.number].url}">
        <button class="remove-btn" onclick="removeStickerFromAlbum(event, ${spot.number})">Remove</button>
      `;
    } else {
      spotDiv.textContent = spot.number;
    }

    imageWrap.appendChild(spotDiv);
  });

  document.getElementById('prevBtn').disabled = currentPage === 0;
  document.getElementById('nextBtn').disabled = currentPage === pages.length - 1;
  document.getElementById('frontBtn').style.display = currentPage === pages.length - 1 ? 'flex' : 'none';
}

function nextPage() {
  if (currentPage < pages.length - 1) {
    currentPage++;
    renderPage('next');
  }
}

function previousPage() {
  if (currentPage > 0) {
    currentPage--;
    renderPage('prev');
  }
}

function goToFront() {
  currentPage = 0;
  renderPage('prev');
}

function chooseSticker(spotNumber) {
  if (!album || !album.id) {
    setStatus('This link cannot save stickers yet');
    return;
  }

  selectedSpot = spotNumber;
  document.getElementById('fileInput').click();
}

document.getElementById('fileInput').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file || selectedSpot === null || !album) return;

  const extension = file.type === 'image/png' ? 'png' : 'jpg';
  const storagePath = `${album.code}/spot-${selectedSpot}-${Date.now()}.${extension}`;

  setStatus('Saving...');

  const uploadResult = await supabaseClient.storage
    .from('album-uploads')
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type
    });

  if (uploadResult.error) {
    setStatus('Error saving sticker');
    return;
  }

  const upsertResult = await supabaseClient
    .from('album_stickers')
    .upsert({
      album_id: album.id,
      spot_number: selectedSpot,
      storage_path: storagePath,
      updated_at: new Date().toISOString()
    }, { onConflict: 'album_id,spot_number' });

  if (upsertResult.error) {
    setStatus('Error saving sticker');
    return;
  }

  savedStickers[selectedSpot] = { storagePath, url: uploadUrl(storagePath) };
  selectedSpot = null;
  this.value = '';
  renderPage();
  setStatus('Saved');
});

async function removeStickerFromAlbum(event, spotNumber) {
  event.stopPropagation();

  if (!album || !savedStickers[spotNumber]) return;

  setStatus('Removing...');

  const storagePath = savedStickers[spotNumber].storagePath;

  await supabaseClient.storage.from('album-uploads').remove([storagePath]);

  const deleteResult = await supabaseClient
    .from('album_stickers')
    .delete()
    .eq('album_id', album.id)
    .eq('spot_number', spotNumber);

  if (deleteResult.error) {
    setStatus('Error removing sticker');
    return;
  }

  delete savedStickers[spotNumber];
  renderPage();
  setStatus('Removed');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

loadAlbum();
