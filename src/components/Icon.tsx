/** Small black-and-white line icons drawn in currentColor, so they follow light and dark mode. */
const PATHS: Record<string, string> = {
  bookmark: "M6 3h12v18l-6-4.5L6 21z",
  search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 21 21",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  settings: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  council: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 2.7-5 6-5s6 2 6 5M12.5 15.4c1-.3 2.2-.4 3.5-.4 3.3 0 6 2 6 5",
  up: "M12 19V5M5 12l7-7 7 7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  focus: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v4M12 18v4M2 12h4M18 12h4",
  outline: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  map: "M12 4v4M12 8 6 14M12 8l6 6M6 14v4M18 14v4M4 18h4M16 18h4",
  close: "M6 6l12 12M18 6 6 18",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  share: "M12 3v12M7 8l5-5 5 5M5 14v6h14v-6",
  play: "M7 4v16l13-8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  prev: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  story: "M4 5h16v12H4zM9 9.5v5l4.5-2.5zM8 21h8",
  select: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  highlight: "M14.5 3.5l6 6-8.5 8.5H6v-6zM4 21h8",
  branch: "M6 3v18M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 4-12 10",
  back: "M15 18l-6-6 6-6",
  visualize: "M12 5.5a2 2 0 1 1 0 .01M5 18.5a2 2 0 1 1 0 .01M19 18.5a2 2 0 1 1 0 .01M11 7.5l-5 9M13 7.5l5 9M7 18.5h10",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled, size = 18, title }: { name: IconName; filled?: boolean; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
