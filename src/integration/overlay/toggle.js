const TEXT = { pt: 'Ocultar contas', en: 'Hide accounts' };
const box = document.querySelector('#hide');
const label = document.querySelector('label span');
window.toggle.onLanguage((language) => {
  const text = TEXT[language] || TEXT.pt;
  document.documentElement.lang = language === 'en' ? 'en' : 'pt-BR';
  document.title = text;
  label.textContent = text;
});
window.toggle.onHidden((hidden) => { box.checked = hidden; });
box.addEventListener('change', async () => {
  const wanted = box.checked;
  box.disabled = true;
  try { box.checked = await window.toggle.setHidden(wanted); }
  catch { box.checked = !wanted; }
  finally { box.disabled = false; }
});
