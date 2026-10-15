export interface LearnerProfile {
  name: string;
  domain: string;
  background: string;
  level: 'Beginner' | 'Basic' | 'Intermediate' | 'Advanced';
  goal: string;
  style: string;
  hours: number;
  weeks: number;
  startDate: string;
  studyDays: number[];
}

export interface RoadmapTask {
  text: string;
  minutes: number;
}

export interface RoadmapDay {
  day: string;
  focus: string;
  tasks: RoadmapTask[];
}

export interface RoadmapWeek {
  week: number;
  theme: string;
  goal: string;
  checkpoint: string;
  days: RoadmapDay[];
  resources: Array<{ title: string; type: string; why: string; query: string }>;
}

export interface Roadmap {
  title: string;
  summary: string;
  weeks: RoadmapWeek[];
  generatedAt?: string;
}
