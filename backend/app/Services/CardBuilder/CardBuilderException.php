<?php

namespace App\Services\CardBuilder;

use RuntimeException;

class CardBuilderException extends RuntimeException
{
    /** @param bool $user true: the message is for the user (422); false: a server/tool problem (500) */
    public function __construct(string $message, public readonly bool $user = true)
    {
        parent::__construct($message);
    }
}
