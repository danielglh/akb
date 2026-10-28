export interface Candidate { path: string; score: number | null }
export interface SearchRequest { root: string; query: string; limit: number }
export interface Retriever {
  search(request: SearchRequest): Candidate[];
}
