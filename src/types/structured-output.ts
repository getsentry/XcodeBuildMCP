export interface StructuredOutputEnvelope<TData> {
  schema: string;
  schemaVersion: string;
  didError: boolean;
  error: string | null;
  data: TData | null;
}
