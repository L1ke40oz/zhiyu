// Local adaptation of phone-party's commentator. No provider SDK or login is required.
const pick = values => values[Math.floor(Math.random() * values.length)];
export function aiStatus() { return '内置主持词'; }
export async function roundComment({ ranking, game }) {
  const first = ranking[0];
  if (!first) return '海风吹过，下一关见。';
  if (!first.success) return '这一关有点挑战，下一轮一起找回节奏！';
  return pick([`${first.name} 在《${game.title}》里率先靠岸，大家继续加油！`, `${first.name} 拿下这一轮，码头响起掌声！`, '放轻松，下一轮的海风已经来了。']);
}
export async function finalComment(standings) {
  return standings[0] ? `本场派对之星是 ${standings[0].name}！谢谢每一位一起出发的伙伴。` : '派对暂时靠岸，下次再一起玩。';
}
