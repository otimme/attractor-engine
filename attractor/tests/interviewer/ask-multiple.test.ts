import { describe, test, expect } from "bun:test";
import {
  QuestionType,
  AnswerValue,
  createQuestion,
  createAnswer,
} from "../../src/types/index.js";
import type { Question } from "../../src/types/index.js";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve.js";
import { QueueInterviewer } from "../../src/interviewer/queue.js";
import { RecordingInterviewer } from "../../src/interviewer/recording.js";

function yesNoQuestion(text: string): Question {
  return createQuestion({ text, type: QuestionType.YES_NO });
}

function freeformQuestion(text: string): Question {
  return createQuestion({ text, type: QuestionType.FREEFORM });
}

describe("askMultiple", () => {
  describe("QueueInterviewer", () => {
    test("returns answers in order", async () => {
      const a1 = createAnswer({ value: "first" });
      const a2 = createAnswer({ value: "second" });
      const a3 = createAnswer({ value: "third" });
      const interviewer = new QueueInterviewer([a1, a2, a3]);

      const questions = [
        freeformQuestion("Q1"),
        freeformQuestion("Q2"),
        freeformQuestion("Q3"),
      ];
      const answers = await interviewer.askMultiple(questions);

      expect(answers).toHaveLength(3);
      expect(answers[0]?.value).toBe("first");
      expect(answers[1]?.value).toBe("second");
      expect(answers[2]?.value).toBe("third");
    });

    test("returns SKIPPED for questions beyond queue length", async () => {
      const a1 = createAnswer({ value: "only" });
      const interviewer = new QueueInterviewer([a1]);

      const questions = [freeformQuestion("Q1"), freeformQuestion("Q2")];
      const answers = await interviewer.askMultiple(questions);

      expect(answers).toHaveLength(2);
      expect(answers[0]?.value).toBe("only");
      expect(answers[1]?.value).toBe(AnswerValue.SKIPPED);
    });
  });

  describe("AutoApproveInterviewer", () => {
    test("returns YES for each yes/no question", async () => {
      const interviewer = new AutoApproveInterviewer();

      const questions = [yesNoQuestion("Q1"), yesNoQuestion("Q2")];
      const answers = await interviewer.askMultiple(questions);

      expect(answers).toHaveLength(2);
      expect(answers[0]?.value).toBe(AnswerValue.YES);
      expect(answers[1]?.value).toBe(AnswerValue.YES);
    });

    test("returns first option for multiple choice questions", async () => {
      const interviewer = new AutoApproveInterviewer();

      const questions = [
        createQuestion({
          text: "Pick",
          type: QuestionType.MULTIPLE_CHOICE,
          options: [
            { key: "a", label: "Option A" },
            { key: "b", label: "Option B" },
          ],
        }),
      ];
      const answers = await interviewer.askMultiple(questions);

      expect(answers).toHaveLength(1);
      expect(answers[0]?.value).toBe("a");
      expect(answers[0]?.selectedOption).toEqual({ key: "a", label: "Option A" });
    });
  });

  describe("RecordingInterviewer", () => {
    test("records all question-answer pairs", async () => {
      const inner = new AutoApproveInterviewer();
      const recording = new RecordingInterviewer(inner);

      const q1 = yesNoQuestion("Q1");
      const q2 = yesNoQuestion("Q2");
      const answers = await recording.askMultiple([q1, q2]);

      expect(answers).toHaveLength(2);
      expect(recording.recordings).toHaveLength(2);
      expect(recording.recordings[0]?.question).toBe(q1);
      expect(recording.recordings[0]?.answer).toBe(answers[0]);
      expect(recording.recordings[1]?.question).toBe(q2);
      expect(recording.recordings[1]?.answer).toBe(answers[1]);
    });
  });

  describe("empty questions array", () => {
    test("QueueInterviewer returns empty array", async () => {
      const interviewer = new QueueInterviewer([]);
      const answers = await interviewer.askMultiple([]);
      expect(answers).toEqual([]);
    });

    test("AutoApproveInterviewer returns empty array", async () => {
      const interviewer = new AutoApproveInterviewer();
      const answers = await interviewer.askMultiple([]);
      expect(answers).toEqual([]);
    });

    test("RecordingInterviewer returns empty array and records nothing", async () => {
      const inner = new AutoApproveInterviewer();
      const recording = new RecordingInterviewer(inner);
      const answers = await recording.askMultiple([]);
      expect(answers).toEqual([]);
      expect(recording.recordings).toHaveLength(0);
    });
  });
});
