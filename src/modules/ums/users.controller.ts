import { Controller } from '@nestjs/common';
import { UserService } from './services/users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UserService) {}
}
