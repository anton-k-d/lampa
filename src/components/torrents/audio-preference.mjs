const russian = /(?:^|[^a-zа-яё])(?:ru|rus|russian|русск(?:ий|ая|ое|ие|ого|ом)?)(?=$|[^a-zа-яё])/i;
const ukrainian = /(?:^|[^a-zа-яё])(?:uk|ukr|ukrainian|украинск(?:ий|ая|ое|ие)?)(?=$|[^a-zа-яё])/i;
const dub = /дубляж|дублирован|(?:^|[^a-z])dub(?:bed)?(?=$|[^a-z])/i;
function language(text) {
    if (russian.test(text || '')) return 'ru';
    if (ukrainian.test(text || '')) return 'uk';
    return '';
}
function trackLanguage(track) {
    const tags = track.tags || {};
    return language(tags.language) || language((tags.title || '') + ' ' + (tags.handler_name || ''));
}
function isDub(track) {
    const tags = track.tags || {};
    return dub.test((tags.title || '') + ' ' + (tags.handler_name || ''));
}
export function preferredAudioTracks(tracks) {
    const ru = tracks.filter(track => trackLanguage(track) === 'ru');
    if (!ru.length) return tracks.slice();
    return ru.filter(isDub).concat(ru.filter(track => !isDub(track)), tracks.filter(track => !trackLanguage(track)));
}
export function audioPreference(item) {
    const tracks = (item.ffprobe || []).filter(track => track.codec_type === 'audio');
    const ru = tracks.filter(track => trackLanguage(track) === 'ru');
    if (ru.length) return ru.some(isDub) ? 2 : 1;
    if (tracks.length && tracks.every(track => trackLanguage(track) === 'uk')) return -1;
    const title = item.Title || '';
    // A subtitle label is not evidence of an audio language.
    const audioTitle = title.replace(/(?:^|[^a-zа-яё])(?:(?:ru|rus|russian|русск[а-яё]*|uk|ukr|ukrainian|украинск[а-яё]*|en|eng|english)(?:[\s/,&+()[\]{}:.-]+(?:ru|rus|russian|русск[а-яё]*|uk|ukr|ukrainian|украинск[а-яё]*|en|eng|english))*[\s()[\]{}:.-]*(?:sub(?:title)?s?|субтитры)|(?:sub(?:title)?s?|субтитры)[\s()[\]{}:.-]*(?:ru|rus|russian|русск[а-яё]*|uk|ukr|ukrainian|украинск[а-яё]*|en|eng|english)(?:[\s/,&+()[\]{}:.-]+(?:ru|rus|russian|русск[а-яё]*|uk|ukr|ukrainian|украинск[а-яё]*|en|eng|english))*)(?=$|[^a-zа-яё])/ig,' ');
    if (language(audioTitle) === 'ru') return dub.test(audioTitle) ? 2 : 1;
    return 0;
}
