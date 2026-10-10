import type { MediaKind } from "./types";

export type StoryScope = "answer" | "pyramid" | "branch" | "text";
export type PictureType = "shapes" | "image" | "video";
export type PartStatus = "pending" | "running" | "done" | "error";

export interface StorySlide {
  heading: string;
  narration: string;
  visual: string;
  /** what this slide currently shows */
  picture: PictureType;
  /** inline SVG text for "shapes" */
  svg?: string;
  pictureStatus: PartStatus;
  pictureError?: string;
  /** media table ids */
  imageId?: string;
  videoId?: string;
  /** a remote clip url kept when the download was blocked */
  videoUrl?: string;
  videoJob?: { id: string; model: string; status: string; startedAt: number };
  /** what the AI image or video cost (usage.cost) */
  pictureCost?: number;
  audioId?: string;
  audioStatus: PartStatus;
  audioError?: string;
}

export interface Story {
  id: string;
  sessionId: string;
  cardId: string;
  scope: StoryScope;
  nodeIds?: string[];
  /** scope "text": the exact words the story teaches (a selection) */
  material?: string;
  title: string;
  scenario: string;
  style: string;
  slides: StorySlide[];
  status: PartStatus;
  error?: string;
  createdAt: number;
}

export type { MediaKind };
