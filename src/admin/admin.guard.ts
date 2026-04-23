import { CanActivate, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(): boolean {
    // TODO(prod): validate admin JWT / API key here
    return true;
  }
}
