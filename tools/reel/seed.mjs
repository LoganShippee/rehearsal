// Demo data for the recording: three classes with their own look, agenda and progress. Lives only in the throwaway headless browser.
import { sleep, dismissWelcome, setClock } from './lib.mjs';
export const CHAPTERS = ['Edit in seconds', 'Sight reading', 'Student practice', 'Build exercises', 'Worksheets & HW', 'Score rehearsal', 'Your own scores', 'Student homework', 'Everything else'];
export async function seed(R, url) {
  await R.page.goto(url, { waitUntil: 'networkidle2' }); await sleep(900); await dismissWelcome(R);
  await R.page.evaluate((CH) => {
    const [choir, band, orch] = S.classes;
    choir.subtitle = 'Period 1'; band.subtitle = 'Period 2'; orch.subtitle = 'Period 3';
    choir.agenda = CH.map(t => ({ text: t, min: 0 }));
    const prog = (title, status, steps) => ({ id: uid(), title, status, open: true, steps: steps.map(([text, done]) => ({ id: uid(), text, done })) });
    choir.progress = [prog('Ode to Joy', 'yellow', [['Notes', true], ['Rhythm', true], ['Dynamics', false]]), prog('Sight-reading level 3', 'green', []), prog('Spring Concert set', 'red', [['Memorize', false]])];
    choir.sideProgress = true; choir.sideProgOpen = true;
    Object.assign(choir.theme, { name: 'Sky', bg: '#e3f2fd', accent: '#1565c0', text: '#0d1b2a', image: 'bg:waves' });
    Object.assign(band.theme, { name: 'Ember', bg: '#3b1d12', accent: '#ffb347', text: '#fff7ee', image: 'bg:risers', titleText: '#ffffff', clockText: '#ffffff' });
    band.agenda = [{ text: 'Long tones', min: 3 }, { text: 'Scales & arpeggios', min: 4 }, { text: 'Marching show', min: 4 }, { text: 'Pack up', min: 2 }];
    band.progress = [prog('Fall show opener', 'green', []), prog('Concert march', 'yellow', [])]; band.sideProgress = true;
    Object.assign(orch.theme, { name: 'Forest', bg: '#14342a', accent: '#95d5b2', text: '#ffffff', image: 'bg:staff', titleText: '#ffffff', clockText: '#ffffff' });
    orch.agenda = [{ text: 'Tune up', min: 3 }, { text: 'Bowing drills', min: 5 }, { text: 'Rehearsal', min: 15 }];
    S.events = [{ id: uid(), kind: 'announcement', date: dateKey(new Date()), title: 'Concert Friday: black folders and concert dress', time: '', yearly: false, classes: [] }];
    S.classes.forEach(c => { c.screenNotes = {}; }); S.settings.sim.on = false; S.settings.welcome = false;
    save();
  }, CHAPTERS);
  await sleep(900); await R.page.reload({ waitUntil: 'networkidle2' }); await sleep(900);
  await dismissWelcome(R); await R.page.evaluate(() => { P.tour = null; document.querySelectorAll('button').forEach(b => { if (b.innerText.trim() === 'Close' && b.offsetParent) b.click(); }); }); await setClock(R, 8, 10, 0); await sleep(1200);
}
