import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioPreference, preferredAudioTracks} from '../../../src/components/torrents/audio-preference.mjs';

test('Russian dubbing sorts ahead of Russian and Ukrainian without mutating tracks',()=>{
 const uk={codec_type:'audio',tags:{language:'ukr'}}, ru={codec_type:'audio',tags:{language:'rus'}}, dub={codec_type:'audio',tags:{language:'Russian',title:'Дубляж'}};
 const tracks=[uk,ru,dub];
 assert.deepEqual(preferredAudioTracks(tracks),[dub,ru]);
 assert.deepEqual(tracks,[uk,ru,dub]);
 assert.equal(audioPreference({ffprobe:tracks}),2);
});
test('title fallback recognises Russian audio but subtitles and dub alone do not prove it',()=>{
 assert.equal(audioPreference({Title:'Фильм Русский дубляж'}),2);
 assert.equal(audioPreference({Title:'Film DUB',ffprobe:[{codec_type:'subtitle',tags:{language:'rus'}}]}),0);
 assert.equal(audioPreference({ffprobe:[{codec_type:'audio',tags:{language:'ukr'}}]}),-1);
 assert.equal(audioPreference({Title:'Unknown'}),0);
});

test('subtitle language in either order does not establish audio language',()=>{
 assert.equal(audioPreference({Title:'Film subtitles RUS'}),0);
 assert.equal(audioPreference({Title:'Film RUS subtitles'}),0);
});

test('confirmed Ukrainian audio overrides conflicting Russian title hints',()=>{
 const uk={codec_type:'audio',tags:{language:'ukr'}};
 assert.equal(audioPreference({Title:'Film RUS (subtitles)',ffprobe:[uk]}),-1);
 assert.equal(audioPreference({Title:'Film Russian dub',ffprobe:[uk]}),-1);
 assert.equal(audioPreference({Title:'Film RUS (subtitles)'}),0);
});

test('subtitle-only language labels do not imply Russian audio',()=>{
 const subtitle={codec_type:'subtitle',tags:{language:'rus'}};
 for (const title of ['Film [RU SUB]', 'Film RU subtitles', 'Film RUS/UKR subtitles', 'Film RUS SUB']) {
  assert.equal(audioPreference({Title:title,ffprobe:[subtitle]}),0,title);
 }
 assert.equal(audioPreference({Title:'Film [RU Dub][EN Sub]'}),2);
 assert.equal(audioPreference({Title:'Film [RU SUB]',ffprobe:[{codec_type:'audio',tags:{language:'rus'}}]}),1);
});
