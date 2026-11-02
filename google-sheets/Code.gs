/**
 * Грабелька: Google Таблица как база данных.
 * Вставьте этот код в Расширения → Apps Script, поменяйте пароль ниже и разверните как веб-приложение.
 * Листы «Фермы», «Товары», «Проверка», «Заказы» создаются сами при первой записи.
 * Цветные столбцы можно править прямо в таблице: сайт подхватит новые значения. Столбец «data» не трогайте.
 */
const ADMIN_KEY = 'поменяйте-этот-пароль'; // пароль команды: проверка ферм и загрузка примеров

const SHEETS = {
  farms:    { name: 'Фермы',    cols: [['name','Название'],['person','Контакт'],['phone','Телефон'],['district','Район'],['km','Км от СПб'],['spec','Что производит'],['minOrder','Мин. заказ']] },
  products: { name: 'Товары',   cols: [['name','Товар'],['category','Категория'],['unit','Фасовка'],['price','Цена'],['harvestDate','Дата сбора'],['active','В каталоге']] },
  verified: { name: 'Проверка', cols: [['ok','Проверена']] },
  leads:    { name: 'Заявки',   cols: [['district','Район'],['phone','Телефон'],['createdAt','Когда']] },
  orders:   { name: 'Заказы',   cols: [['num','Номер'],['status','Статус'],['farmName','Ферма'],['buyerName','Покупатель'],['phone','Телефон'],['address','Адрес'],['total','Сумма'],['commission','Комиссия'],['deliveryDate','Дата доставки'],['slot','Время'],['weekly','Еженедельно']] },
};
const FIXED = 3; // id, коллекция, обновлено

function doGet(e) {
  const p = e.parameter || {};
  if (p.action === 'admin') return out({ ok: p.key === ADMIN_KEY });
  return out({ ok: true, docs: readAll() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = JSON.parse(e.postData.contents);
    const writes = b.op === 'batch' ? b.writes : [b];
    writes.forEach(w => apply(w, b.key, b.uid));
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err.message || err), code: err.code || '' });
  } finally {
    lock.releaseLock();
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function kind(coll) {
  if (coll === 'farms') return 'farms';
  if (/^farms\/[A-Za-z0-9_\-.~:@+]+\/products$/.test(coll)) return 'products';
  if (coll === 'verified' || coll === 'orders' || coll === 'leads') return coll;
  throw new Error('Неизвестный раздел: ' + coll);
}

function sheet(k) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = SHEETS[k];
  let sh = ss.getSheetByName(d.name);
  if (!sh) {
    sh = ss.insertSheet(d.name);
    const head = ['id', 'раздел', 'обновлено'].concat(d.cols.map(c => c[1]), ['data (не редактировать)']);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.getRange(1, FIXED + 1, 1, d.cols.length).setBackground('#e3ebd6');
    sh.getRange('A:Z').setNumberFormat('@'); // keep dates and prices as typed
    sh.setFrozenRows(1);
  }
  return sh;
}

function fmt(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

// sheet cells win over the stored JSON, so the table works as an admin panel
function rowToDoc(k, row) {
  const d = SHEETS[k];
  let data = {};
  try { data = JSON.parse(row[FIXED + d.cols.length] || '{}'); } catch (e) {}
  d.cols.forEach((c, i) => {
    let v = row[FIXED + i];
    if (v === '' || v === null || v === undefined) return;
    const orig = data[c[0]];
    if (typeof orig === 'number') v = Number(String(v).replace(',', '.'));
    else if (typeof orig === 'boolean') v = String(v).toUpperCase() === 'TRUE';
    else v = String(v);
    data[c[0]] = v;
  });
  return { coll: String(row[1]), id: String(row[0]), data: data };
}

function readAll() {
  const docs = [];
  Object.keys(SHEETS).forEach(k => {
    if (k === 'leads') return; // заявки видны только в таблице
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS[k].name);
    if (!sh || sh.getLastRow() < 2) return;
    const width = FIXED + SHEETS[k].cols.length + 1;
    sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(r => { if (r[0] !== '') docs.push(rowToDoc(k, r)); });
  });
  return docs;
}

function findRow(sh, coll, id) {
  if (sh.getLastRow() < 2) return -1;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id && String(ids[i][1]) === coll) return i + 2;
  return -1;
}

function denied(msg) { const e = new Error(msg); e.code = 'invalid_argument'; return e; }

function apply(w, key, uid) {
  const k = kind(w.coll);
  if (k === 'verified' && key !== ADMIN_KEY) throw denied('Отмечать проверку может только команда');
  const farmId = k === 'farms' ? String(w.id) : k === 'products' ? w.coll.split('/')[1] : null;
  if (farmId && key !== ADMIN_KEY && uid !== farmId) throw denied('Это не ваша ферма'); // защита от ошибок, не от взлома
  const sh = sheet(k), d = SHEETS[k];
  if (k === 'leads' && w.op !== 'set' && key !== ADMIN_KEY) throw denied('Заявку можно только добавить');
  const r = findRow(sh, w.coll, String(w.id));
  if (w.op === 'delete') { if (r > 0) sh.deleteRow(r); return; }
  let data = w.data || {};
  if (w.op === 'update') {
    if (r < 0) throw denied('Запись не найдена');
    const width = FIXED + d.cols.length + 1;
    data = Object.assign(rowToDoc(k, sh.getRange(r, 1, 1, width).getValues()[0]).data, data);
  }
  if (typeof data.photo === 'string' && data.photo.indexOf('data:image') === 0) data.photo = savePhoto(data.photo, w.id);
  const json = JSON.stringify(data);
  if (json.length > 49000) throw denied('Слишком большая запись');
  const row = [String(w.id), w.coll, new Date().toISOString()].concat(d.cols.map(c => fmt(data[c[0]])), [json]);
  if (r > 0) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function savePhoto(dataUrl, name) {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw denied('Фото не распознано');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '.jpg');
  const it = DriveApp.getFoldersByName('Грабелька — фото');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('Грабелька — фото');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

// Запустите один раз вручную (кнопка «Выполнить»), чтобы выдать скрипту доступ к таблице и Диску.
function setup() {
  Object.keys(SHEETS).forEach(sheet);
  DriveApp.getRootFolder();
}
