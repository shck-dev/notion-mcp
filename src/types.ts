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

export type RichTextSegment = [string] | [string, Array<[string, string?]>];

export interface NotionRawBlock {
  id: string;
  type: string;
  properties?: {
    title?: RichTextSegment[];
    checked?: [["Yes"]] | [["No"]];
    language?: [[string]];
    source?: [[string]];
    [key: string]: any;
  };
  content?: string[];
  format?: {
    page_icon?: string;
    table_block_column_order?: string[];
    [key: string]: any;
  };
}

export type BlockMap = Record<string, { value: NotionRawBlock }>;
