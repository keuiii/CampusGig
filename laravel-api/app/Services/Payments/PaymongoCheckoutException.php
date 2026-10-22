<?php

namespace App\Services\Payments;

use RuntimeException;

class PaymongoCheckoutException extends RuntimeException
{
    public function __construct(string $message, public readonly string $outcome)
    {
        parent::__construct($message);
    }
}
