const adjectives = [
  'thoughtful', 'seasoned', 'restful', 'radiant', 'clever', 'bright',
  'swift', 'calm', 'bold', 'brave', 'eager', 'fierce', 'gentle',
  'happy', 'jolly', 'kind', 'lively', 'merry', 'noble', 'proud',
  'quick', 'sharp', 'smart', 'wise', 'witty', 'zealous', 'agile',
  'astute', 'brisk', 'clear', 'crisp', 'keen', 'lucid', 'neat',
  'quiet', 'rapid', 'solid', 'sound', 'valid', 'warm', 'zesty'
];

const names = [
  'adam', 'dan', 'tina', 'ron', 'alice', 'bob', 'charlie', 'dave',
  'eve', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'olivia',
  'peggy', 'sybil', 'trudy', 'victor', 'walter', 'zoe', 'alex', 'sam',
  'max', 'leo', 'mia', 'ava', 'ian', 'eli', 'fay', 'guy', 'hal',
  'jay', 'kim', 'lee', 'mac', 'ned', 'pam', 'ray', 'sal', 'ted'
];

export function generateChatName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const name = names[Math.floor(Math.random() * names.length)];
  return `${adj}-${name}`;
}
