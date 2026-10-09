import type { Answer, AnswerNode, Pyramid } from "../answer";
import { groupPath, nodesInGroup } from "../answer";
import type { Card } from "../types";
import { BookmarkButton } from "./BookmarkButton";
import { Icon } from "./Icon";

const KIND = { foundation: "Foundation", step: "Step", conclusion: "Conclusion" } as const;

/** Details of the selected point(s) or category, with what they rest on and support. */
export function NodePanel({
  sessionId,
  nodes,
  groupId,
  answerOf,
  pyramidOf,
  allNodes,
  bookmarked,
  selectMode,
  onSelectNode,
  onAskPyramid,
  onToggleSelectMode,
  onStory,
  onClose,
}: {
  sessionId: string;
  /** selected points (with the card that owns each) */
  nodes: { node: AnswerNode; card: Card }[];
  groupId?: { id: string; card: Card };
  answerOf: (cardId: string) => Answer | undefined;
  pyramidOf: (nodeId: string) => Pyramid | undefined;
  allNodes: Map<string, { node: AnswerNode; card: Card }>;
  bookmarked: Set<string>;
  selectMode: boolean;
  onSelectNode: (id: string) => void;
  onAskPyramid: (p: Pyramid, card: Card) => void;
  onToggleSelectMode: () => void;
  onStory?: () => void;
  onClose: () => void;
}) {
  const close = (
    <button className="btn icon sm" aria-label="Close" onClick={onClose}>
      <Icon name="close" />
    </button>
  );

  if (groupId) {
    const ans = answerOf(groupId.card.id);
    const g = ans?.groups.find((x) => x.id === groupId.id);
    const members = ans ? nodesInGroup(ans, groupId.id).map((id) => allNodes.get(id)?.node).filter((n): n is AnswerNode => !!n) : [];
    return (
      <section className="panel" aria-label="Category">
        <div className="panel-head">
          <span className="kind-badge">Category</span>
          <strong className="grow">{g?.title}</strong>
          {close}
        </div>
        <ul className="panel-list">
          {members.map((n) => (
            <li key={n.id}>
              <button className="link-btn" onClick={() => onSelectNode(n.id)}>{n.text}</button>
            </li>
          ))}
        </ul>
        <p className="muted small">Your next question is about this whole category.</p>
      </section>
    );
  }

  if (nodes.length > 1) {
    return (
      <section className="panel" aria-label="Selected points">
        <div className="panel-head">
          <strong className="grow">{nodes.length} points selected</strong>
          <button className={`btn sm ${selectMode ? "on" : ""}`} onClick={onToggleSelectMode}>
            {selectMode ? "Done selecting" : "Select more"}
          </button>
          {close}
        </div>
        <ul className="panel-list">
          {nodes.map(({ node }) => (
            <li key={node.id}>{node.text}</li>
          ))}
        </ul>
      </section>
    );
  }

  const { node, card } = nodes[0];
  const ans = answerOf(card.id);
  const path = ans ? groupPath(ans, node.group) : [];
  const restsOn = node.from.map((id) => allNodes.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const supports = [...allNodes.values()].filter((x) => x.node.from.includes(node.id));
  const pyramid = pyramidOf(node.id);
  return (
    <section className="panel" aria-label="Selected point">
      <div className="panel-head">
        <span className={`kind-badge ${node.kind}`}>{KIND[node.kind]}</span>
        {path.length > 0 && <span className="muted small grow ellipsis">{path.map((g) => g.title).join(" › ")}</span>}
        {!path.length && <span className="grow" />}
        <BookmarkButton on={bookmarked.has(node.id)} sessionId={sessionId} cardId={card.id} nodeId={node.id} label={node.title ?? node.text} />
        {close}
      </div>
      {node.title && <strong>{node.title}</strong>}
      <p className="panel-text">{node.text}</p>
      {node.grounded === false && <p className="badge-warn small">Not in the council's answers</p>}
      {node.sources?.length ? <p className="muted small">From council answers {node.sources.join(", ")}</p> : null}
      {restsOn.length > 0 && (
        <>
          <p className="muted small">Rests on</p>
          <ul className="panel-list">
            {restsOn.map((x) => (
              <li key={x.node.id}>
                <button className="link-btn" onClick={() => onSelectNode(x.node.id)}>
                  {x.card.id !== card.id && <span className="muted small">(earlier) </span>}
                  {x.node.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {supports.length > 0 && (
        <>
          <p className="muted small">Supports</p>
          <ul className="panel-list">
            {supports.map((x) => (
              <li key={x.node.id}>
                <button className="link-btn" onClick={() => onSelectNode(x.node.id)}>
                  {x.card.id !== card.id && <span className="muted small">(later) </span>}
                  {x.node.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="chips">
        <button className={`btn chip ${selectMode ? "on" : ""}`} onClick={onToggleSelectMode}>
          <Icon name="select" size={14} /> {selectMode ? "Done selecting" : "Select more"}
        </button>
        {pyramid && (
          <button className="btn chip" onClick={() => onAskPyramid(pyramid, card)}>
            Ask about the whole pyramid
          </button>
        )}
        {onStory && (
          <button className="btn chip" onClick={onStory}>
            <Icon name="story" size={14} /> Learn as a story
          </button>
        )}
      </div>
    </section>
  );
}
