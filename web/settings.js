// Settings screen: one page, with the cards in a sensible order (what you change most often first).
// app.js's settingsTab() builds each card; this file only decides the order.
// No setting is added or removed, and every data-bind / data-action stays exactly as it was.
window.SETTINGS_UI = (() => {
  function render(c) {
    // Rhythm counts is a row of the Sound card, as it always was
    const sound = c.sound.replace(/<\/div>$/, c.rhythm + '</div>');
    return [c.present, c.grading, sound, c.homework, c.test, c.drive, c.bookmarks, c.updates, c.backups, c.backup, c.coffee].join('\n');
  }
  return { render };
})();
