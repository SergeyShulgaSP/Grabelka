// Где Грабелька хранит данные.
//   backend: ''          — демонстрация без базы: примеры ферм, заказы только в браузере посетителя
//   backend: 'sheets'    — Google Таблица (вставьте адрес веб-приложения Apps Script в sheetsUrl)
//   backend: 'supabase'  — база Supabase (Project URL и anon public key)
window.GRABELKA_CONFIG = {
  backend: 'sheets',
  sheetsUrl: 'https://script.google.com/macros/s/AKfycbzdMkTrLVcv1I7OEDKZUzI1CWeSwjRAbqyNYN8KMXl7I8Bc3htEjWOwGNuqd9rGaHC7/exec',
  supabaseUrl: '',
  supabaseAnonKey: '',    // только anon public, никогда service_role
};
