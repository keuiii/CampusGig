<?php

namespace App\Services\Payments;

use RuntimeException;

class PaymongoRefundException extends RuntimeException
{
    public function __construct(string $message, public readonly string $outcome, public readonly ?string $providerCode = null)
    {
        parent::__construct($message);
    }
}
