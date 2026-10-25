export default function IslandEmblem({ small = false }: { small?: boolean }) {
  return (
    <span className={`island-emblem${small ? ' small' : ''}`} aria-hidden="true">
      <i className="emblem-water" />
      <i className="emblem-sand" />
      <i className="emblem-grass" />
      <i className="emblem-trunk" />
      <i className="emblem-tree" />
      <i className="emblem-house" />
      <i className="emblem-roof" />
    </span>
  );
}
