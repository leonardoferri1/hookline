import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Principal } from '../application/principal';
import { ApiKeyGuard } from './api-key.guard';
import { CurrentPrincipal } from './scopes.decorator';
import { CurrentPrincipalView } from './tenant.dto';

@ApiTags('tenants')
@ApiSecurity('apiKey')
@Controller('me')
@UseGuards(ApiKeyGuard)
export class TenantsController {
  @Get()
  @ApiOperation({
    summary: 'Describe the authenticated tenant, the presented key and the applicable limits.',
  })
  @ApiOkResponse({ type: CurrentPrincipalView })
  me(@CurrentPrincipal() principal: Principal): CurrentPrincipalView {
    return CurrentPrincipalView.from(principal);
  }
}
