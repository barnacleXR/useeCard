import { Controller, Get, Inject } from '@nestjs/common';
import { SystemService } from './system.service.js';
@Controller('api/system')
export class SystemController {constructor(@Inject(SystemService) private readonly system:SystemService){}@Get() status(){return this.system.status();}}
