import {
  Body,
  Controller,
  HttpException,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('mocks')
@Controller('mock')
export class MockController {
  private readonly logger = new Logger(MockController.name);

  @Post('webhook')
  @ApiOperation({ summary: 'Mock webhook target' })
  webhook(@Body() body: unknown, @Query('fail') fail?: string) {
    return this.respond('webhook', body, fail);
  }

  @Post('email')
  @ApiOperation({ summary: 'Mock email service' })
  email(@Body() body: unknown, @Query('fail') fail?: string) {
    return this.respond('email', body, fail);
  }

  @Post('internal-service')
  @ApiOperation({ summary: 'Mock internal service' })
  internalService(@Body() body: unknown, @Query('fail') fail?: string) {
    return this.respond('internal-service', body, fail);
  }

  private respond(label: string, body: unknown, fail?: string) {
    const status = fail ? Number(fail) : 200;
    this.logger.log(
      `mock/${label} status=${status} body=${JSON.stringify(body)}`,
    );
    if (status !== 200) {
      throw new HttpException(`mock failure ${status}`, status);
    }
    return { ok: true };
  }
}
