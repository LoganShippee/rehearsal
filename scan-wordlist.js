'use strict';
/* Rehearsal Scan & Fix — Choir & Liturgical Word List for OMR Lyric Verification.
   Zero external dependencies: runs identically in browsers and macOS JavaScriptCore (jsc). */

const SF_CHOIR_WORDLIST = new Set([
  // Sacred, hymn, & choral repertoire words
  'abide', 'bide', 'eventide', 'ev', 'stille', 'nacht', 'darkness', 'deepens', 'lord', 'helper', 'fail', 'comforts', 'flee',
  'help', 'helpless', 'soul', 'silent', 'night', 'holy', 'virgin', 'mother', 'child', 'tender',
  'mild', 'sleep', 'heavenly', 'peace', 'savior', 'saviour', 'shepherds', 'quake', 'glories',
  'stream', 'afar', 'hosts', 'sing', 'alleluia', 'hallelujah', 'praise', 'grace', 'mercy',
  'glory', 'heaven', 'earth', 'heart', 'spirit', 'light', 'king', 'love', 'joy', 'crown',
  'throne', 'angel', 'angels', 'eternal', 'everlasting', 'blessing', 'blessed', 'amen',
  'christ', 'jesus', 'god', 'father', 'son', 'ghost', 'lamb', 'cross', 'blood', 'body',
  'bread', 'wine', 'cup', 'song', 'hymn', 'psalm', 'chorus', 'choir', 'voice', 'voices',
  'prayer', 'pray', 'faith', 'hope', 'truth', 'life', 'death', 'grave', 'rise', 'risen',
  'reign', 'almighty', 'majesty', 'kingdom', 'power', 'honor', 'honour', 'worship', 'adore',
  'redeemer', 'creator', 'shepherd', 'flock', 'altar', 'temple', 'sanctuary', 'sacred',
  'divine', 'radiant', 'shining', 'bright', 'star', 'stars', 'morning', 'evening', 'dawn',
  'noon', 'midnight', 'forever', 'evermore', 'hallowed', 'righteous', 'faithful', 'humble',
  'gentle', 'pure', 'merry', 'glad', 'rejoice', 'triumph', 'victory', 'salvation', 'deliver',
  'forgive', 'forgiveness', 'compassion', 'wisdom', 'strength', 'refuge', 'fortress', 'shield',
  'banner', 'trumpet', 'harp', 'lute', 'organ', 'bell', 'bells', 'ring', 'chime',

  // Latin liturgical words
  'ave', 'verum', 'corpus', 'natum', 'de', 'maria', 'virgine', 'vere', 'passum', 'immolatum',
  'in', 'cruce', 'pro', 'homine', 'cuius', 'latus', 'perforatum', 'unda', 'fluxit', 'et',
  'sanguine', 'esto', 'nobis', 'praegustatum', 'mortis', 'examine', 'o', 'iesu', 'jesu',
  'dulcis', 'pie', 'fili', 'sicut', 'cervus', 'desiderat', 'ad', 'fontes', 'aquarum', 'ita',
  'anima', 'mea', 'te', 'deus', 'deum', 'sitivit', 'locus', 'iste', 'a', 'deo', 'factus',
  'est', 'inaestimabile', 'sacramentum', 'irreprehensibilis', 'sub', 'tuum', 'praesidium',
  'confugimus', 'sancta', 'dei', 'genitrix', 'nostras', 'deprecationes', 'ne', 'despicias',
  'necessitatibus', 'sed', 'periculis', 'cunctis', 'libera', 'nos', 'semper', 'virgo',
  'gloriosa', 'benedicta', 'kyrie', 'eleison', 'christe', 'gloria', 'excelsis', 'pax',
  'hominibus', 'bonae', 'voluntatis', 'laudamus', 'benedicimus', 'adoramus', 'glorificamus',
  'gratias', 'agimus', 'propter', 'magnam', 'tuam', 'credo', 'patrem', 'omnipotentem',
  'sanctus', 'dominus', 'sabaoth', 'pleni', 'sunt', 'caeli', 'coeli', 'terra', 'hosanna',
  'osanna', 'benedictus', 'qui', 'venit', 'nomine', 'agnus', 'tollis', 'peccata', 'mundi',
  'miserere', 'dona', 'pacem', 'requiem', 'aeternam', 'lux', 'perpetua', 'alleluja',
  'dixit', 'magnificat', 'nunc', 'dimittis', 'salve', 'regina', 'mater', 'misericordiae',
  'vita', 'dulcedo', 'spes', 'nostra', 'pater', 'noster', 'panis', 'angelicus', 'tantum',
  'ergo', 'venite', 'adoremus', 'laudate', 'pueri', 'omnes', 'gentes', 'cantate', 'canticum',
  'novum', 'exultate', 'jubilate', 'confitemini', 'quoniam', 'bonus', 'saecula', 'saeculorum',

  // German / French / Italian common choral words
  'stille', 'nacht', 'heilige', 'alles', 'schlaft', 'schläft', 'einsam', 'wacht', 'nur',
  'das', 'traute', 'hochheilige', 'paar', 'holder', 'knabe', 'im', 'lockigen', 'haar',
  'schlaf', 'himmlischer', 'ruh', 'gottes', 'sohn', 'lacht', 'lieb', 'aus', 'deinem',
  'göttlichen', 'mund', 'da', 'uns', 'schlägt', 'rettende', 'stund', 'christ', 'retter',
  'ist', 'herr', 'lobet', 'den', 'und', 'ein', 'eine', 'der', 'die', 'von', 'mit', 'zu',

  // Core 400+ common English words (pronouns, prepositions, articles, verbs, nouns, adjectives)
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old',
  'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use',
  'that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know', 'want', 'been',
  'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long',
  'make', 'many', 'more', 'only', 'over', 'such', 'take', 'than', 'them', 'well', 'were',
  'what', 'able', 'about', 'above', 'after', 'again', 'against', 'alone', 'along', 'also',
  'always', 'among', 'another', 'answer', 'around', 'away', 'back', 'bear', 'beat', 'beauty',
  'because', 'become', 'before', 'begin', 'behind', 'being', 'believe', 'below', 'beneath',
  'beside', 'best', 'better', 'between', 'beyond', 'bird', 'birds', 'black', 'blow', 'blue',
  'born', 'both', 'break', 'breath', 'breathe', 'bring', 'brother', 'build', 'burn', 'call',
  'calm', 'came', 'care', 'carry', 'cast', 'catch', 'cause', 'change', 'city', 'clean',
  'clear', 'close', 'cloud', 'clouds', 'cold', 'comes', 'coming', 'command', 'complete',
  'could', 'count', 'country', 'course', 'cover', 'cried', 'cry', 'dance', 'dare', 'dark',
  'daughter', 'dead', 'dear', 'deep', 'desire', 'door', 'down', 'dream', 'dreams', 'drink',
  'drop', 'dust', 'dwell', 'each', 'early', 'east', 'easy', 'echo', 'eight', 'else', 'empty',
  'end', 'ends', 'enemy', 'enough', 'enter', 'even', 'ever', 'every', 'everyone', 'everything',
  'evil', 'eye', 'eyes', 'face', 'fade', 'fair', 'fall', 'far', 'fast', 'fear', 'feel',
  'feet', 'fell', 'felt', 'few', 'field', 'fields', 'fill', 'find', 'fine', 'fire', 'first',
  'five', 'flame', 'flower', 'flowers', 'fly', 'follow', 'food', 'foot', 'forever', 'forget',
  'form', 'forth', 'found', 'four', 'free', 'friend', 'friends', 'full', 'garden', 'gate',
  'gates', 'gather', 'gave', 'give', 'given', 'gladness', 'glow', 'goes', 'going', 'gold',
  'golden', 'gone', 'great', 'green', 'grief', 'ground', 'grow', 'guide', 'hand', 'hands',
  'hang', 'happy', 'hard', 'harm', 'hate', 'have', 'head', 'heal', 'hear', 'heard', 'heat',
  'heavy', 'held', 'here', 'high', 'hill', 'hills', 'hold', 'home', 'hour', 'hours', 'house',
  'human', 'hundred', 'hurt', 'hush', 'ice', 'ill', 'into', 'iron', 'island', 'keep', 'kept',
  'kind', 'knew', 'know', 'known', 'laid', 'lake', 'lambs', 'land', 'last', 'late', 'laugh',
  'lead', 'leaf', 'learn', 'least', 'leave', 'left', 'less', 'lies', 'lift', 'light', 'line',
  'lips', 'listen', 'little', 'live', 'lives', 'lone', 'lonely', 'look', 'lose', 'lost',
  'loud', 'low', 'lullaby', 'made', 'make', 'makes', 'march', 'mark', 'master', 'may', 'mean',
  'meet', 'melt', 'memory', 'men', 'mighty', 'mind', 'mine', 'mist', 'moment', 'moon',
  'morn', 'most', 'mountain', 'mountains', 'mouth', 'move', 'music', 'must', 'name', 'near',
  'need', 'never', 'next', 'nice', 'nine', 'none', 'nor', 'north', 'note', 'notes', 'nothing',
  'number', 'ocean', 'off', 'offer', 'often', 'once', 'open', 'other', 'others', 'over',
  'own', 'page', 'pain', 'pale', 'part', 'pass', 'past', 'path', 'pay', 'people', 'perhaps',
  'place', 'plain', 'plan', 'play', 'please', 'poor', 'pour', 'present', 'pretty', 'pride',
  'prince', 'promise', 'proud', 'pull', 'push', 'queen', 'quick', 'quiet', 'quite', 'rain',
  'raise', 'ran', 'reach', 'read', 'ready', 'real', 'reason', 'rest', 'return', 'rich', 'ride',
  'right', 'river', 'rivers', 'road', 'rock', 'roll', 'room', 'rose', 'round', 'run', 'runs',
  'rush', 'sad', 'safe', 'said', 'sail', 'saint', 'saints', 'same', 'sand', 'sang', 'save',
  'saw', 'says', 'sea', 'seas', 'season', 'seat', 'second', 'see', 'seek', 'seem', 'seen',
  'self', 'send', 'sense', 'sent', 'serve', 'set', 'seven', 'shade', 'shadow', 'shadows',
  'shall', 'shalt', 'shape', 'share', 'shine', 'ship', 'shore', 'short', 'should', 'shout',
  'show', 'shut', 'side', 'sigh', 'sight', 'sign', 'silence', 'silver', 'simple', 'since',
  'sister', 'sit', 'six', 'sky', 'slow', 'slowly', 'small', 'smile', 'snow', 'soft', 'softly',
  'soil', 'sold', 'some', 'someone', 'something', 'sometimes', 'soon', 'sorrow', 'sorry',
  'sound', 'south', 'speak', 'speech', 'speed', 'spend', 'spent', 'spoke', 'spring', 'stand',
  'start', 'state', 'stay', 'steadfast', 'steal', 'step', 'still', 'stone', 'stood', 'stop',
  'storm', 'story', 'straight', 'strange', 'street', 'strong', 'such', 'sudden', 'suffer',
  'summer', 'sun', 'sung', 'sunlight', 'sunrise', 'sunset', 'sure', 'sweet', 'sweetly',
  'swift', 'swim', 'sword', 'table', 'tail', 'talk', 'tall', 'taste', 'teach', 'tear', 'tears',
  'tell', 'ten', 'thank', 'thanks', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'thick', 'thin', 'thing', 'things', 'think', 'third', 'thirst', 'this',
  'those', 'thou', 'though', 'thought', 'thousand', 'three', 'threw', 'through', 'throughout',
  'throw', 'thus', 'thy', 'thine', 'thee', 'tide', 'till', 'today', 'together', 'told',
  'tomorrow', 'tone', 'tongue', 'tonight', 'took', 'top', 'touch', 'toward', 'towards',
  'town', 'tree', 'trees', 'tremble', 'tried', 'true', 'truly', 'trust', 'try', 'turn',
  'twelve', 'twenty', 'twice', 'under', 'understand', 'until', 'unto', 'upon', 'used',
  'vain', 'valley', 'valleys', 'vast', 'veil', 'verse', 'view', 'visit', 'wait', 'wake',
  'walk', 'wall', 'wander', 'want', 'war', 'warm', 'warn', 'wash', 'watch', 'water', 'waters',
  'wave', 'waves', 'weak', 'wear', 'weary', 'weather', 'weep', 'welcome', 'west', 'what',
  'whatever', 'wheel', 'where', 'wherever', 'whether', 'which', 'while', 'whisper', 'white',
  'whole', 'whom', 'whose', 'why', 'wide', 'wild', 'wilderness', 'wind', 'winds', 'window',
  'wing', 'wings', 'winter', 'wise', 'wish', 'with', 'within', 'without', 'woke', 'woman',
  'women', 'wonder', 'wondrous', 'wood', 'woods', 'word', 'words', 'work', 'world', 'worlds',
  'worth', 'worthy', 'would', 'wound', 'write', 'wrong', 'year', 'years', 'yes', 'yesterday',
  'yet', 'yield', 'yon', 'yonder', 'young', 'yours', 'yourself', 'youth', 'zeal', 'zion',

  // Common 2-letter / short words & exclamations
  'a', 'i', 'o', 'ah', 'oh', 'ha', 'la', 'lo', 'ye', 'am', 'an', 'as', 'at', 'be', 'by',
  'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
  'up', 'us', 'we', 'fa', 're', 'mi', 'sol', 'ti', 'do', 'si', 'hey', 'ooh', 'hmm', 'mmm',
  'yeah', 'yea', 'nay', 'woe', 'foe', 'bow', 'vow', 'dew', 'dawn', 'dusk', 'eve'
]);

const SF_CHOIR_SHORT_OK = new Set([
  'a', 'i', 'o', 'ah', 'oh', 'ha', 'la', 'lo', 'ye', 'am', 'an', 'as', 'at', 'be', 'by',
  'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
  'up', 'us', 'we'
]);

function sfIsKnownChoirWord(word) {
  let w = String(word == null ? '' : word).trim();
  // Strip leading/trailing punctuation, quotes, hyphens, and leading/trailing verse numbers like "1."
  w = w.replace(/^\d+\.?\s*|\s*\d+\.?$/g, '');
  w = w.replace(/^[\s"'“”‘’.,;:!?()\[\]—–-]+|[\s"'“”‘’.,;:!?()\[\]—–-]+$/g, '');
  if (!w) return true;

  w = w.replace(/[\u2018\u2019]/g, "'").toLowerCase();
  if (w.length <= 1) return true;
  if (w.length === 2) return SF_CHOIR_SHORT_OK.has(w) || SF_CHOIR_WORDLIST.has(w);

  // Reject mixed digits or non-letter noise
  if (/[^a-zäöüßéèêàâîïôûùç'-]/i.test(w)) return false;

  if (SF_CHOIR_WORDLIST.has(w)) return true;

  // Handle contractions: 's, 'd, 'll, 've, 're, 'm, n't
  const apos = w.indexOf("'");
  if (apos > 0) {
    const stem = w.slice(0, apos);
    const suf = w.slice(apos);
    if (suf === "'s" || suf === "'d" || suf === "'ll" || suf === "'ve" || suf === "'re" || suf === "'m") {
      if (SF_CHOIR_WORDLIST.has(stem)) return true;
    }
    if (w.endsWith("n't") && w.length > 3) {
      const base = w.slice(0, -3);
      if (base === 'ca' || base === 'wo' || base === 'sha' || base === 'ai' || SF_CHOIR_WORDLIST.has(base)) {
        return true;
      }
    }
  }

  // Handle common English inflections: -s, -es, -ies->-y, -ed, -ied->-y, -ing, -er, -est, -ly, -th, -st
  const candidates = [];
  if (w.endsWith('ies') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) candidates.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('s') && w.length > 2) candidates.push(w.slice(0, -1));
  if (w.endsWith('ed') && w.length > 3) candidates.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 4) candidates.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er') && w.length > 3) candidates.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est') && w.length > 4) candidates.push(w.slice(0, -3), w.slice(0, -2));
  if (w.endsWith('ly') && w.length > 3) candidates.push(w.slice(0, -2));
  if (w.endsWith('th') && w.length > 3) candidates.push(w.slice(0, -2));
  if (w.endsWith('st') && w.length > 3) candidates.push(w.slice(0, -2), w.slice(0, -1));

  for (const c of candidates) {
    if (SF_CHOIR_WORDLIST.has(c)) return true;
  }
  return false;
}
