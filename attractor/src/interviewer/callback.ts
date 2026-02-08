import type { Question, Answer, Interviewer } from "../types/index.js";
import { AnswerValue, createAnswer } from "../types/index.js";

export class CallbackInterviewer implements Interviewer {
  private readonly callback: (question: Question) => Promise<Answer>;

  constructor(callback: (question: Question) => Promise<Answer>) {
    this.callback = callback;
  }

  ask(question: Question): Promise<Answer> {
    const callbackPromise = this.callback(question);
    const timeoutSeconds = question.timeoutSeconds;

    if (timeoutSeconds === undefined) {
      return callbackPromise;
    }

    const timeoutPromise = new Promise<Answer>((resolve) => {
      setTimeout(
        () => resolve(createAnswer({ value: AnswerValue.TIMEOUT })),
        timeoutSeconds * 1000,
      );
    });

    return Promise.race([callbackPromise, timeoutPromise]);
  }

  async askMultiple(questions: Question[]): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const q of questions) {
      answers.push(await this.ask(q));
    }
    return answers;
  }

  inform(_message: string, _stage: string): Promise<void> {
    return Promise.resolve();
  }
}
