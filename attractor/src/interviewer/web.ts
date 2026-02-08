import type { Question, Answer, Interviewer } from "../types/interviewer.js";
import { AnswerValue, createAnswer } from "../types/interviewer.js";

interface PendingQuestion {
  id: string;
  question: Question;
  resolve: (answer: Answer) => void;
}

/**
 * A web-based Interviewer that queues questions for HTTP retrieval
 * and accepts answers via HTTP POST.
 */
export type InformListener = (message: string, stage: string) => void;

export class WebInterviewer implements Interviewer {
  private pending: PendingQuestion | undefined;
  private messages: Array<{ message: string; stage: string }> = [];
  private informListeners: InformListener[] = [];
  private nextId = 1;

  ask(question: Question): Promise<Answer> {
    const id = String(this.nextId++);
    return new Promise<Answer>((resolve) => {
      this.pending = { id, question, resolve };

      if (question.timeoutSeconds !== undefined) {
        setTimeout(() => {
          if (this.pending?.question === question) {
            this.pending = undefined;
            resolve(createAnswer({ value: AnswerValue.TIMEOUT }));
          }
        }, question.timeoutSeconds * 1000);
      }
    });
  }

  async askMultiple(questions: Question[]): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const q of questions) {
      answers.push(await this.ask(q));
    }
    return answers;
  }

  inform(message: string, stage: string): Promise<void> {
    this.messages.push({ message, stage });
    for (const listener of this.informListeners) {
      listener(message, stage);
    }
    return Promise.resolve();
  }

  /** Register a listener that fires on each inform() call (e.g. for SSE streaming). */
  onInform(listener: InformListener): void {
    this.informListeners.push(listener);
  }

  /** Unregister a previously registered inform listener. */
  offInform(listener: InformListener): void {
    const idx = this.informListeners.indexOf(listener);
    if (idx !== -1) {
      this.informListeners.splice(idx, 1);
    }
  }

  /** Returns the currently pending question with its ID, if any. */
  getPendingQuestion(): { id: string; question: Question } | undefined {
    if (!this.pending) return undefined;
    return { id: this.pending.id, question: this.pending.question };
  }

  /** Submits an answer to the pending question. Returns true if the qid matched. */
  submitAnswer(answer: Answer, qid?: string): boolean {
    if (!this.pending) return false;
    if (qid !== undefined && this.pending.id !== qid) return false;
    this.pending.resolve(answer);
    this.pending = undefined;
    return true;
  }

  /** Returns and clears buffered inform messages. */
  drainMessages(): Array<{ message: string; stage: string }> {
    const result = [...this.messages];
    this.messages = [];
    return result;
  }
}
