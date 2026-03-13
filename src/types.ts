export interface NotionConfig {
  token: string;
  userId: string;
  spaceId: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  properties: Record<string, any>;
  after?: string;
}
