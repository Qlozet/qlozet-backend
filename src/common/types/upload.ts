import { File } from '@nest-lab/fastify-multer'; // or '@nestjs/platform-express/multer'

export interface MulterFile extends File {
  buffer: Buffer;
}
