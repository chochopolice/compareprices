let map;
let userMarker;
let radiusCircle;
let storeMarkers = [];
let stores = [];

const defaultLocation = { lat: 35.681236, lng: 139.767125, label: "初期位置: 東京駅周辺" };
let currentLocation = { ...defaultLocation };

const keywordInput = document.getElementById("keywordInput");
const categorySelect = document.getElementById("categorySelect");
const subcategorySelect = document.getElementById("subcategorySelect");
const storeTypeSelect = document.getElementById("storeTypeSelect");
const sortSelect = document.getElementById("sortSelect");
const radiusInput = document.getElementById("radiusInput");
const searchButton = document.getElementById("searchButton");
const locationButton = document.getElementById("locationButton");
const resultsEl = document.getElementById("results");
const messageEl = document.getElementById("message");
const locationStatusEl = document.getElementById("locationStatus");
const searchStatusEl = document.getElementById("searchStatus");
const filterStatusEl = document.getElementById("filterStatus");
const radiusStatusEl = document.getElementById("radiusStatus");
const resultCountEl = document.getElementById("resultCount");
const summaryTextEl = document.getElementById("summaryText");

const supabaseConfig = {
  url: window.SUPABASE_URL || "",
  anonKey: window.SUPABASE_ANON_KEY || "",
  table: window.SUPABASE_PRODUCT_MASTER_TABLE || "product_master",
};

function initMap() {
  map = L.map("map").setView([currentLocation.lat, currentLocation.lng], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  userMarker = L.marker([currentLocation.lat, currentLocation.lng]).addTo(map).bindPopup("現在地");
  radiusCircle = L.circle([currentLocation.lat, currentLocation.lng], { radius: Number(radiusInput.value) * 1000 }).addTo(map);
}

function updateUserLocation(lat, lng, labelText) {
  currentLocation = { lat, lng, label: labelText };
  userMarker.setLatLng([lat, lng]);
  radiusCircle.setLatLng([lat, lng]);
  map.setView([lat, lng], 14);
  locationStatusEl.textContent = labelText;
}

function clearStoreMarkers() {
  storeMarkers.forEach((marker) => map.removeLayer(marker));
  storeMarkers = [];
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalize(text) {
  return String(text || "").normalize("NFKC").trim().toLowerCase().replace(/[\s\-ー_]+/g, "");
}

function isLooseMatch(query, target) {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return true;
  if (t.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

function formatDate(yyyymmdd) {
  const value = String(yyyymmdd || "");
  if (value.length !== 8) return value || "-";
  return `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

function resetSelect(selectEl, defaultLabel) {
  selectEl.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = defaultLabel;
  selectEl.appendChild(option);
}

function populateFilters() {
  resetSelect(categorySelect, "すべて");
  resetSelect(subcategorySelect, "すべて");
  resetSelect(storeTypeSelect, "すべて");

  const categories = [...new Set(stores.flatMap((store) => store.items.map((item) => item.category).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "ja"));
  const subcategories = [...new Set(stores.flatMap((store) => store.items.map((item) => item.subcategory).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "ja"));
  const storeTypes = [...new Set(stores.map((store) => store.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });

  subcategories.forEach((subcategory) => {
    const option = document.createElement("option");
    option.value = subcategory;
    option.textContent = subcategory;
    subcategorySelect.appendChild(option);
  });

  storeTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    storeTypeSelect.appendChild(option);
  });
}

function searchItems() {
  const keyword = keywordInput.value.trim();
  const category = categorySelect.value;
  const subcategory = subcategorySelect.value;
  const storeType = storeTypeSelect.value;
  const sortBy = sortSelect.value;
  const radiusKm = Number(radiusInput.value || 3);

  searchStatusEl.textContent = `検索語: ${keyword || "未入力"}`;
  radiusStatusEl.textContent = `検索半径: ${radiusKm}km`;

  const filterText = [category ? `カテゴリ=${category}` : null, subcategory ? `サブカテゴリ=${subcategory}` : null, storeType ? `店舗タイプ=${storeType}` : null].filter(Boolean).join(" / ");
  filterStatusEl.textContent = `絞り込み: ${filterText || "なし"}`;

  radiusCircle.setRadius(radiusKm * 1000);
  messageEl.textContent = "";
  clearStoreMarkers();

  const matches = stores.flatMap((store) => {
    if (storeType && store.type !== storeType) return [];
    const distanceKm = getDistanceKm(currentLocation.lat, currentLocation.lng, store.lat, store.lng);
    if (distanceKm > radiusKm) return [];
    return store.items
      .filter((item) => !category || item.category === category)
      .filter((item) => !subcategory || item.subcategory === subcategory)
      .filter((item) => !keyword || isLooseMatch(keyword, item.name) || isLooseMatch(keyword, item.category) || isLooseMatch(keyword, item.subcategory))
      .map((item) => ({
        storeId: store.id,
        storeName: store.name,
        storeType: store.type,
        lat: store.lat,
        lng: store.lng,
        address: store.address || "",
        note: store.note || "",
        matchedItem: item.name,
        matchedPrice: item.price,
        category: item.category || "",
        subcategory: item.subcategory || "",
        lastSeen: item.last_seen || "",
        distanceKm,
      }));
  });

  matches.sort((a, b) => {
    if (sortBy === "distance") return a.distanceKm - b.distanceKm || a.matchedPrice - b.matchedPrice;
    if (sortBy === "updated") return String(b.lastSeen).localeCompare(String(a.lastSeen)) || a.matchedPrice - b.matchedPrice;
    return a.matchedPrice - b.matchedPrice || a.distanceKm - b.distanceKm;
  });

  resultCountEl.textContent = `${matches.length}件`;
  summaryTextEl.textContent = matches.length ? `並び順: ${sortSelect.options[sortSelect.selectedIndex].text}` : "";

  if (matches.length === 0) {
    resultsEl.innerHTML = '<p class="empty-state">該当する商品が見つかりませんでした。商品名、カテゴリ、サブカテゴリ、半径を変えてみてください。</p>';
    return;
  }

  const cheapestPrice = Math.min(...matches.map((x) => x.matchedPrice));
  resultsEl.innerHTML = matches
    .map((row, index) => {
      const isCheapest = row.matchedPrice === cheapestPrice;
      return `<article class="result-card ${isCheapest ? "cheapest" : ""}"><div class="result-top"><div><div class="result-rank">${index + 1}. ${row.storeName}</div><div class="result-meta">${row.storeType} ・ 約 ${row.distanceKm.toFixed(2)}km</div><div class="result-price">${row.matchedItem} ${row.matchedPrice}円</div><div class="result-sub">${row.category || "-"} / ${row.subcategory || "-"}<br>最終確認: ${formatDate(row.lastSeen)}</div></div>${isCheapest ? '<span class="cheapest-tag">最安</span>' : ""}</div></article>`;
    })
    .join("");

  matches.forEach((row) => {
    const marker = L.marker([row.lat, row.lng])
      .addTo(map)
      .bindPopup(`<strong>${row.storeName}</strong><br>${row.storeType}<br>${row.matchedItem}: ${row.matchedPrice}円<br>分類: ${row.category || "-"} / ${row.subcategory || "-"}<br>最終確認: ${formatDate(row.lastSeen)}<br>現在地から約 ${row.distanceKm.toFixed(2)}km`);
    storeMarkers.push(marker);
  });
}

async function fetchProductMasterFromSupabase() {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) return [];
  const url = `${supabaseConfig.url}/rest/v1/${supabaseConfig.table}?select=name,category,subcategory`;
  const response = await fetch(url, {
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabaseの商品マスタ取得に失敗しました (${response.status})`);
  }
  return response.json();
}

function mergeCategoryInfo(masterRows) {
  if (!Array.isArray(masterRows) || masterRows.length === 0) return;
  const byName = new Map();
  masterRows.forEach((row) => {
    const key = normalize(row.name);
    if (!key) return;
    byName.set(key, { category: row.category || "", subcategory: row.subcategory || "" });
  });

  stores = stores.map((store) => ({
    ...store,
    items: (store.items || []).map((item) => {
      const found = byName.get(normalize(item.name));
      if (!found) return item;
      return {
        ...item,
        category: item.category || found.category,
        subcategory: item.subcategory || found.subcategory,
      };
    }),
  }));
}

async function loadStores() {
  const response = await fetch("./stores.json");
  if (!response.ok) throw new Error("stores.json の読込に失敗しました。");
  stores = await response.json();

  try {
    const masterRows = await fetchProductMasterFromSupabase();
    mergeCategoryInfo(masterRows);
  } catch (error) {
    console.warn(error);
    messageEl.textContent = "Supabaseの商品分類データ取得に失敗したため、ローカルデータで表示しています。";
  }
}

function getCurrentLocation() {
  messageEl.textContent = "";
  if (!navigator.geolocation) {
    messageEl.textContent = "このブラウザでは位置情報が使えません。";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      updateUserLocation(position.coords.latitude, position.coords.longitude, "現在地を取得しました");
      searchItems();
    },
    () => {
      messageEl.textContent = "位置情報の取得に失敗しました。ブラウザの許可設定を確認してください。";
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

searchButton.addEventListener("click", searchItems);
locationButton.addEventListener("click", getCurrentLocation);
keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchItems();
});
categorySelect.addEventListener("change", searchItems);
subcategorySelect.addEventListener("change", searchItems);
storeTypeSelect.addEventListener("change", searchItems);
sortSelect.addEventListener("change", searchItems);
radiusInput.addEventListener("change", searchItems);

window.addEventListener("load", async () => {
  try {
    initMap();
    await loadStores();
    populateFilters();
    searchItems();
  } catch (error) {
    console.error(error);
    messageEl.textContent = error.message || "初期化に失敗しました。";
  }
});
