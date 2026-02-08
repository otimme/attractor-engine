import type { Question, Answer, Interviewer } from "../types/index.js";

export interface Recording {
  question: Question;
  answer: Answer;
}

export class RecordingInterviewer implements Interviewer {
  private readonly inner: Interviewer;
  readonly recordings: Recording[] = [];

  constructor(inner: Interviewer) {
    this.inner = inner;
  }

  async ask(question: Question): Promise<Answer> {
    const answer = await this.inner.ask(question);
    this.recordings.push({ question, answer });
    return answer;
  }

  async askMultiple(questions: Question[]): Promise<Answer[]> {
    const answers = await this.inner.askMultiple(questions);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const a = answers[i];
      if (q !== undefined && a !== undefined) {
        this.recordings.push({ question: q, answer: a });
      }
    }
    return answers;
  }

  inform(message: string, stage: string): Promise<void> {
    return this.inner.inform(message, stage);
  }
}
