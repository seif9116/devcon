export interface QuestionLevel {
  text: string;
  options: string[];
  answer: number;
}

export interface Question {
  id: string;
  level1: QuestionLevel;
  level2: QuestionLevel;
  level3: QuestionLevel;
  conceptPages?: string[];
}

export interface WikiPage {
  slug: string;
  title: string;
  moduleId: number;
  body: string;
  relatedSlugs: string[];
}

export interface WikiData {
  pages: WikiPage[];
}

export interface Module {
  id: number;
  name: string;
  questions: Question[];
}

export interface QuestionsData {
  modules: Module[];
}

export interface QuestionProgress {
  level: 1 | 2 | 3;
  completed: boolean;
}

export interface ModuleProgress {
  [questionId: string]: QuestionProgress;
}

export interface AppProgress {
  language: string;
  modules: { [moduleId: string]: ModuleProgress };
}
