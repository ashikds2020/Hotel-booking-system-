// Keyhaven – Hotel Booking System front end (talks to the REST API in ../backend)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => '₹' + Number(n).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nightsBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

let session = JSON.parse(localStorage.getItem('hbs-session') || 'null'); // { token, user }
let lastSearch = {};           // dates carried into the booking dialog
let selectedRoom = null;
let reviewBookingId = null;
let registerMode = false;

// ---------- API helper ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) logout();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- Navigation ----------
function show(view) {
  $$('.view').forEach(v => (v.hidden = v.id !== 'view-' + view));
  if (view === 'mine') loadMyBookings();
  if (view === 'admin') loadAdmin('bookings');
}
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-view]');
  if (nav) { e.preventDefault(); show(nav.dataset.view); }
  if (e.target.matches('[data-close]')) e.target.closest('dialog').close();
});

function renderAuthState() {
  const u = session?.user;
  $('#authBtn').textContent = u ? 'Log out' : 'Log in';
  $('#navMine').hidden = !u;
  $('#navAdmin').hidden = !(u && ['Admin', 'SystemAdmin'].includes(u.role));
}
function logout() {
  session = null;
  localStorage.removeItem('hbs-session');
  renderAuthState();
  show('search');
}

// ---------- Auth ----------
function setAuthMode(reg) {
  registerMode = reg;
  $('#authTitle').textContent = reg ? 'Create your account' : 'Log in';
  $('#authSubmit').textContent = reg ? 'Create account' : 'Log in';
  $('#authSwitch').textContent = reg ? 'I already have an account' : 'Create an account';
  $('#regFields').hidden = !reg;
  $('#authMsg').textContent = '';
}
$('#authBtn').onclick = () => { if (session) return logout(); setAuthMode(false); $('#authDlg').showModal(); };
$('#authSwitch').onclick = () => setAuthMode(!registerMode);

$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    if (registerMode) {
      await api('/auth/register', { method: 'POST', body: f });
      toast('Account created. Logging you in.');
    }
    session = await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password } });
    localStorage.setItem('hbs-session', JSON.stringify(session));
    $('#authDlg').close();
    renderAuthState();
    toast('Welcome, ' + session.user.name.split(' ')[0]);
    if (selectedRoom) openBooking(selectedRoom);
  } catch (err) { $('#authMsg').textContent = err.message; }
};

// ---------- Search ----------
const today = new Date().toISOString().slice(0, 10);
$('[name=checkIn]').min = $('[name=checkOut]').min = today;

$('#searchForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (f.checkOut <= f.checkIn) { $('#searchMsg').textContent = 'Check-out must be after check-in.'; return; }
  lastSearch = f;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  try {
    const rooms = await api('/rooms?' + qs);
    $('#searchMsg').textContent = rooms.length ? `${rooms.length} room${rooms.length > 1 ? 's' : ''} available` : 'No rooms are free for those dates. Try different dates or a nearby city.';
    $('#results').innerHTML = rooms.map(roomCard).join('');
  } catch (err) { $('#searchMsg').textContent = err.message; }
};

function roomCard(r) {
  const n = nightsBetween(lastSearch.checkIn, lastSearch.checkOut);
  return `<article class="room">
    <h3>${esc(r.hotelName)}</h3>
    <p class="meta">${esc(r.city)} · Rated ${r.rating || 'new'}</p>
    <p class="meta">${esc(r.type)} room ${esc(r.roomNumber)} · sleeps ${r.capacity}</p>
    <p class="meta">${esc(r.amenities)}</p>
    <p class="price">${money(r.price)} <small>per night · ${money(r.price * n)} for ${n} night${n > 1 ? 's' : ''}</small></p>
    <div class="row">
      <button class="btn small" data-book='${JSON.stringify({ id: r.roomId, hotel: r.hotelName, type: r.type, price: r.price, cap: r.capacity }).replace(/'/g, '&#39;')}'>Book</button>
      <button class="link" data-reviews="${r.roomId}">Reviews</button>
    </div>
  </article>`;
}

$('#results').onclick = async e => {
  if (e.target.dataset.book) { selectedRoom = JSON.parse(e.target.dataset.book); openBooking(selectedRoom); }
  if (e.target.dataset.reviews) {
    const list = await api('/rooms/' + e.target.dataset.reviews + '/reviews');
    toast(list.length ? `${list.length} reviews, average ${(list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1)}/5. Latest: "${list[0].comment || 'No comment'}"` : 'No reviews yet for this room.');
  }
};

// ---------- Booking ----------
function openBooking(room) {
  if (!session) { setAuthMode(false); $('#authDlg').showModal(); return; }
  const n = nightsBetween(lastSearch.checkIn, lastSearch.checkOut);
  $('#bookSummary').textContent = `${room.hotel} · ${room.type} room · ${lastSearch.checkIn} to ${lastSearch.checkOut} · ${money(room.price * n)} total`;
  $('[name=numGuests]', $('#bookForm')).max = room.cap;
  $('[name=guestName]', $('#bookForm')).value = session.user.name;
  $('#bookMsg').textContent = '';
  $('#bookDlg').showModal();
}

$('#bookForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = $('#payBtn');
  btn.disabled = true;
  $('#bookMsg').textContent = '';
  try {
    const out = await api('/bookings', { method: 'POST', body: {
      roomId: selectedRoom.id, checkIn: lastSearch.checkIn, checkOut: lastSearch.checkOut,
      numGuests: +f.numGuests, guestName: f.guestName, card: { number: f.card },
    } });
    $('#bookDlg').close();
    e.target.reset();
    toast(`Booking #${out.bookingId} confirmed. A confirmation is on its way.`);
    $('#searchForm').requestSubmit();       // refresh availability
    show('mine');
  } catch (err) { $('#bookMsg').textContent = err.message; }
  btn.disabled = false;
};

// ---------- My bookings ----------
async function loadMyBookings() {
  const list = await api('/bookings/mine');
  $('#myBookings').innerHTML = list.length ? list.map(b => `
    <div class="card">
      <div>
        <h3>${esc(b.hotelName)}, ${esc(b.city)}</h3>
        <p class="meta">${esc(b.type)} room ${esc(b.roomNumber)} · ${b.checkInDate} to ${b.checkOutDate} · ${money(b.totalAmount)}</p>
        <span class="badge ${b.status}">${b.status}</span>
      </div>
      <div class="row">
        ${b.status === 'Confirmed' ? `<button class="btn small ghost" data-cancel="${b.bookingId}">Cancel and refund</button>` : ''}
        ${b.status === 'CheckedOut' && !b.reviewed ? `<button class="btn small ghost" data-review="${b.bookingId}">Rate stay</button>` : ''}
      </div>
    </div>`).join('') : '<p class="meta">You have no bookings yet. Search for a room to get started.</p>';
}
$('#myBookings').onclick = async e => {
  if (e.target.dataset.cancel && confirm('Cancel this booking? Your payment will be refunded.')) {
    try { await api(`/bookings/${e.target.dataset.cancel}/cancel`, { method: 'PATCH' }); toast('Booking cancelled. Refund issued.'); loadMyBookings(); }
    catch (err) { toast(err.message); }
  }
  if (e.target.dataset.review) { reviewBookingId = +e.target.dataset.review; $('#reviewMsg').textContent = ''; $('#reviewDlg').showModal(); }
};
$('#reviewForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    await api('/reviews', { method: 'POST', body: { bookingId: reviewBookingId, rating: +f.rating, comment: f.comment } });
    $('#reviewDlg').close(); e.target.reset(); toast('Thanks for your review.'); loadMyBookings();
  } catch (err) { $('#reviewMsg').textContent = err.message; }
};

// ---------- Admin ----------
$$('.tab').forEach(t => (t.onclick = () => loadAdmin(t.dataset.tab)));

async function loadAdmin(tab) {
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  $$('.tabpane').forEach(p => (p.hidden = p.id !== 'tab-' + tab));
  try {
    if (tab === 'bookings') {
      const list = await api('/admin/bookings');
      $('#tab-bookings').innerHTML = `<div class="scroll"><table><tr><th>#</th><th>Guest</th><th>Hotel / room</th><th>Dates</th><th>Total</th><th>Status</th><th></th></tr>` +
        list.map(b => `<tr><td>${b.bookingId}</td><td>${esc(b.guestName)}<br><small>${esc(b.email)}</small></td><td>${esc(b.hotelName)} · ${esc(b.roomNumber)}</td>
        <td>${b.checkInDate} to ${b.checkOutDate}</td><td>${money(b.totalAmount)}</td><td><span class="badge ${b.status}">${b.status}</span></td>
        <td>${b.status === 'Confirmed' ? `<button class="btn small" data-act="checkin" data-id="${b.bookingId}">Check in</button>` : ''}
            ${b.status === 'CheckedIn' ? `<button class="btn small" data-act="checkout" data-id="${b.bookingId}">Check out</button>` : ''}</td></tr>`).join('') + '</table></div>';
    }
    if (tab === 'rooms') {
      const [hotels, rooms] = await Promise.all([api('/admin/hotels'), api('/admin/rooms')]);
      $('#hotelSelect').innerHTML = hotels.map(h => `<option value="${h.hotelId}">${esc(h.name)}</option>`).join('');
      $('#roomList').innerHTML = rooms.map(r => `<div class="card"><div><h3>${esc(r.hotelName)} · ${esc(r.roomNumber)}</h3>
        <p class="meta">${esc(r.type)} · sleeps ${r.capacity} · ${money(r.price)} per night · ${esc(r.status)}</p></div>
        <div class="row"><button class="btn small ghost" data-price="${r.roomId}">Change price</button>
        <button class="btn small ghost" data-toggle="${r.roomId}" data-status="${r.status}">${r.status === 'Active' ? 'Pause' : 'Activate'}</button>
        <button class="btn small ghost" data-remove="${r.roomId}">Remove</button></div></div>`).join('');
    }
    if (tab === 'reports') {
      const r = await api('/admin/reports');
      $('#tab-reports').innerHTML = `<div class="stats">
        <div class="stat"><strong>${money(r.revenue)}</strong>Revenue collected</div>
        <div class="stat"><strong>${r.occupancyPct}%</strong>Occupied today (${r.occupiedToday} of ${r.totalRooms} rooms)</div>
        ${r.byStatus.map(s => `<div class="stat"><strong>${s.count}</strong>${s.status}</div>`).join('')}</div>
        <div class="scroll"><table><tr><th>Month</th><th>Bookings</th><th>Revenue</th></tr>
        ${r.monthly.map(m => `<tr><td>${m.month}</td><td>${m.bookings}</td><td>${money(m.revenue)}</td></tr>`).join('') || '<tr><td colspan="3">No bookings yet.</td></tr>'}</table></div>`;
    }
  } catch (err) { toast(err.message); }
}

$('#tab-bookings').onclick = async e => {
  if (!e.target.dataset.act) return;
  try { await api(`/admin/bookings/${e.target.dataset.id}/${e.target.dataset.act}`, { method: 'PATCH' }); loadAdmin('bookings'); }
  catch (err) { toast(err.message); }
};
$('#roomForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    await api('/admin/rooms', { method: 'POST', body: { ...f, hotelId: +f.hotelId, price: +f.price, capacity: +f.capacity } });
    e.target.reset(); toast('Room added.'); loadAdmin('rooms');
  } catch (err) { toast(err.message); }
};
$('#roomList').onclick = async e => {
  const d = e.target.dataset;
  try {
    if (d.price) { const p = +prompt('New price per night (₹)'); if (!(p > 0)) return; await api('/admin/rooms/' + d.price, { method: 'PUT', body: { price: p } }); }
    else if (d.toggle) await api('/admin/rooms/' + d.toggle, { method: 'PUT', body: { status: d.status === 'Active' ? 'Paused' : 'Active' } });
    else if (d.remove) { if (!confirm('Remove this room? Past bookings are kept.')) return; await api('/admin/rooms/' + d.remove, { method: 'DELETE' }); }
    else return;
    loadAdmin('rooms');
  } catch (err) { toast(err.message); }
};

renderAuthState();
