import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection } from 'mongoose';

/**
 * Shared harness for flow tests: a REAL Mongo (in-memory) with the app's real
 * schemas, so tests catch what unit mocks never do — ObjectId/string drift,
 * update-operator behaviour, validation. External providers stay stubbed at
 * the service boundary.
 */
export class MemoryMongo {
  private server!: MongoMemoryServer;
  connection!: Connection;

  async start(): Promise<Connection> {
    this.server = await MongoMemoryServer.create();
    this.connection = await mongoose
      .createConnection(this.server.getUri())
      .asPromise();
    return this.connection;
  }

  model<T = any>(name: string, schema: mongoose.Schema): mongoose.Model<T> {
    return this.connection.model<T>(name, schema);
  }

  async stop() {
    await this.connection?.close();
    await this.server?.stop();
  }
}

/** Quiet logger stub — class-field loggers don't exist on Object.create'd instances. */
export const stubLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};
